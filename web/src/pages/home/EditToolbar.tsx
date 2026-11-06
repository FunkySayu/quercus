import { useEffect, useMemo, useRef, useState } from 'react';
import { listSpecies } from '../../api';
import { Icon, useClickOutside } from '../../components/ui';
import type { Species } from '../../models/species';
import { type EditTool, redo, setPaletteReference, setTool, undo, useEditTools } from '../../stores/edit-tools';
import { showToast } from '../../stores/toast';
import { compareReferences, continentColor } from './crown-style';

/** "Quercus robur" → "Q. robur" (nom d'usage à défaut de nom scientifique). */
export function shortSpeciesName(species: Pick<Species, 'nom_scientifique' | 'nom_usage' | 'reference'>): string {
  const name = species.nom_scientifique || species.nom_usage || species.reference;
  return name.replace(/^Quercus\b\s*/i, 'Q. ');
}

/** Casse et accents ignorés pour le filtre de la palette. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const TOOLS: { tool: EditTool; icon: string; label: string; key: string }[] = [
  { tool: 'cursor', icon: 'near_me', label: 'Sélection', key: 'V' },
  { tool: 'pipette', icon: 'colorize', label: 'Pipette : prélever la fiche d’une couronne', key: 'I' },
  { tool: 'paint', icon: 'format_paint', label: 'Peindre : attribuer la fiche de la palette', key: 'B' },
  { tool: 'erase', icon: 'format_color_reset', label: 'Effacer : retirer une fiche peinte', key: 'E' },
  { tool: 'delete', icon: 'delete_outline', label: 'Supprimer : masquer une couronne', key: 'D' },
];

/** Verre dépoli sombre : pendant inversé (fond foncé, icônes claires) du GLASS de la frise. */
const DARK_GLASS =
  'bg-neutral-900/80 text-white/90 shadow-[0_2px_10px_rgba(0,0,0,0.3)] ring-1 ring-white/10 ' +
  'backdrop-blur-xl backdrop-saturate-[1.8]';
const HOVER = 'hover:bg-white/15';

const TOOL_BUTTON =
  'flex size-5 shrink-0 items-center justify-center rounded-full transition ' +
  'cursor-pointer focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none ' +
  'disabled:cursor-default disabled:opacity-35';

function Separator() {
  return <span aria-hidden="true" className="mx-1 h-3 shrink-0 border-l border-white/25" />;
}

async function replay(action: typeof undo, failure: string) {
  try {
    const done = await action();
    if (done) {
      showToast(done.label);
    }
  } catch {
    showToast(failure, { action: 'Fermer', duration: 5000 });
  }
}

/**
 * Barre d'outils d'édition, flottante au-dessus de la frise des fonds de carte et
 * réservée aux utilisateurs connectés : annuler / rétablir, outils de carte
 * (sélection, pipette, peinture, suppression) et palette des fiches du catalogue.
 * Raccourcis : Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y), V / I / B / D.
 */
export function EditToolbar() {
  const tool = useEditTools((s) => s.tool);
  const canUndo = useEditTools((s) => s.past.length > 0 && !s.busy);
  const canRedo = useEditTools((s) => s.future.length > 0 && !s.busy);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' || key === 'y') {
          event.preventDefault();
          if (key === 'y' || event.shiftKey) {
            void replay(redo, 'Échec du rétablissement.');
          } else {
            void replay(undo, "Échec de l'annulation.");
          }
        }
        return;
      }
      if (event.altKey) {
        return;
      }
      const match = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (match) {
        setTool(match.tool);
      } else if (key === 'escape') {
        setTool('cursor');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Outils d'édition"
      className={`pointer-events-auto flex h-7 max-w-full items-center gap-0.5 rounded-full px-1.5 ${DARK_GLASS}`}
    >
      <button
        type="button"
        title="Annuler (Ctrl+Z)"
        aria-label="Annuler"
        disabled={!canUndo}
        className={`${TOOL_BUTTON} ${HOVER}`}
        onClick={() => void replay(undo, "Échec de l'annulation.")}
      >
        <Icon name="undo" className="text-xs!" />
      </button>
      <button
        type="button"
        title="Rétablir (Ctrl+Maj+Z)"
        aria-label="Rétablir"
        disabled={!canRedo}
        className={`${TOOL_BUTTON} ${HOVER}`}
        onClick={() => void replay(redo, 'Échec du rétablissement.')}
      >
        <Icon name="redo" className="text-xs!" />
      </button>

      <Separator />

      {TOOLS.map(({ tool: t, icon, label, key }) => {
        const active = t === tool;
        return (
          <button
            key={t}
            type="button"
            title={`${label} (${key})`}
            aria-label={label}
            aria-pressed={active}
            className={
              `${TOOL_BUTTON} ` +
              (active ? 'bg-white text-neutral-900' : HOVER)
            }
            onClick={() => setTool(t)}
          >
            <Icon name={icon} className="text-xs!" />
          </button>
        );
      })}

      <Separator />

      <PaletteDropdown />
    </div>
  );
}

/** Menu déroulant des fiches du catalogue (ouvert vers le haut), avec filtre. */
function PaletteDropdown() {
  const reference = useEditTools((s) => s.paletteReference);
  const [species, setSpecies] = useState<Species[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  useClickOutside(rootRef, () => setOpen(false), open);

  useEffect(() => {
    let cancelled = false;
    listSpecies()
      .then((list) => !cancelled && setSpecies([...list].sort((a, b) => compareReferences(a.reference, b.reference))))
      .catch(() => !cancelled && showToast('Impossible de charger le catalogue.', { action: 'Fermer', duration: 5000 }));
    return () => {
      cancelled = true;
    };
  }, []);

  const current = species.find((s) => s.reference === reference) ?? null;
  const filtered = useMemo(() => {
    const query = normalize(filter);
    if (!query) {
      return species;
    }
    return species.filter((s) =>
      normalize(`${s.reference} ${s.nom_scientifique} ${shortSpeciesName(s)} ${s.nom_usage}`).includes(query),
    );
  }, [species, filter]);

  const choose = (s: Species) => {
    setPaletteReference(s.reference);
    setTool('paint');
    setOpen(false);
    setFilter('');
  };

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Palette : fiche à attribuer"
        className={`flex h-5 max-w-[150px] min-w-0 cursor-pointer items-center gap-0.5 rounded-full px-1 text-[11px] transition ${HOVER} focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none`}
        onClick={() => setOpen(!open)}
      >
        {current ? (
          <span
            aria-hidden="true"
            className="mx-px size-2.5 shrink-0 rounded-full ring-1 ring-white/40"
            style={{ backgroundColor: continentColor(current.continent) }}
          />
        ) : (
          <Icon name="palette" className="text-[11px]!" />
        )}
        <span className={`truncate ${current ? 'italic' : 'text-white/55'}`}>
          {current ? shortSpeciesName(current) : 'Palette'}
        </span>
        <Icon name={open ? 'expand_more' : 'expand_less'} className="text-[10px]! text-white/60" />
      </button>

      {open && (
        <div
          className={
            'absolute right-0 bottom-full mb-2 flex max-h-[min(360px,calc(100vh-240px))] w-[min(240px,calc(100vw-24px))] flex-col ' +
            'overflow-hidden rounded-xl bg-neutral-900/90 text-white/90 shadow-[0_12px_48px_rgba(0,0,0,0.35)] ring-1 ring-white/10 ' +
            'backdrop-blur-2xl backdrop-saturate-[1.8]'
          }
        >
          <div className="border-b border-white/10 p-1">
            <input
              type="search"
              autoFocus
              value={filter}
              placeholder="Filtrer (nom, référence…)"
              aria-label="Filtrer les fiches"
              className="h-6 w-full rounded-md bg-white/10 px-2 text-xs outline-none placeholder:text-white/40 focus:ring-2 focus:ring-white/40"
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length) {
                  choose(filtered[0]);
                }
              }}
            />
          </div>
          <ul role="listbox" aria-label="Fiches du catalogue" className="overflow-y-auto p-1">
            {filtered.map((s) => {
              const selected = s.reference === reference;
              return (
                <li key={s.reference} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    title={s.nom_usage || undefined}
                    className={
                      'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs ' +
                      'hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none ' +
                      (selected ? 'bg-white/15' : '')
                    }
                    onClick={() => choose(s)}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full ring-1 ring-white/40"
                      style={{ backgroundColor: continentColor(s.continent) }}
                    />
                    <span className={`min-w-0 flex-1 truncate italic ${selected ? 'font-medium' : ''}`}>
                      {shortSpeciesName(s)}
                    </span>
                    <span className="shrink-0 text-[10px] text-white/45 tabular-nums">{s.reference}</span>
                  </button>
                </li>
              );
            })}
            {!filtered.length && <li className="px-2 py-2 text-center text-xs text-white/45">Aucune fiche</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
