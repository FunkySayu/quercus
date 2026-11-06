import { useMemo, useRef, useState } from 'react';
import { Icon, useClickOutside } from '../../components/ui';
import { type Crown, isIdentified } from '../../models/crown';
import { COLOR_SCHEMES, setColorScheme } from '../../stores/color-scheme';
import { selectCrown } from '../../stores/crowns';
import { GLASS, PRESSABLE } from './BaseLayerTimeline';
import { CONTINENT_COLORS, type CrownColoring, DEFAULT_CROWN_COLOR, compareReferences } from './crown-style';
import { shortSpeciesName } from './EditToolbar';
import { speciesColor } from './species-colors';

interface LegendEntry {
  key: string;
  label: string;
  /** Pastille pleine ; null : simple contour blanc (couronne sans teinte). */
  color: string | null;
  count: number;
  /** Clic : sélectionne un arbre de cette fiche (mode « Espèce »). */
  crown?: Crown;
  italic?: boolean;
}

function legendEntries(crowns: Crown[], coloring: CrownColoring): LegendEntry[] {
  const identified = crowns.filter(isIdentified);
  switch (coloring.scheme) {
    case 'continent': {
      const entries: LegendEntry[] = Object.entries(CONTINENT_COLORS).map(([continent, color]) => ({
        key: continent,
        label: continent,
        color,
        count: identified.filter((crown) => crown.continent === continent).length,
      }));
      entries.push({
        key: 'other',
        label: 'Non renseigné',
        color: DEFAULT_CROWN_COLOR,
        count: identified.filter((crown) => !crown.continent || !CONTINENT_COLORS[crown.continent]).length,
      });
      return entries.filter((entry) => entry.count > 0);
    }
    case 'species': {
      const byReference = new Map<string, LegendEntry>();
      for (const crown of identified) {
        const reference = crown.reference ?? '';
        const entry = byReference.get(reference);
        if (entry) {
          entry.count++;
        } else {
          byReference.set(reference, {
            key: reference,
            label: shortSpeciesName({
              reference,
              nom_scientifique: crown.nom_scientifique ?? '',
              nom_usage: crown.nom_usage ?? crown.name ?? '',
            }),
            color: speciesColor(reference) ?? DEFAULT_CROWN_COLOR,
            count: 1,
            crown,
            italic: true,
          });
        }
      }
      return Array.from(byReference.values()).sort((a, b) => compareReferences(a.key, b.key));
    }
    case 'planting': {
      const visible = crowns.filter((crown) => !crown.hidden);
      const entries: LegendEntry[] = coloring.plantingClasses.map((plantingClass) => ({
        key: String(plantingClass.plantedBy),
        label: plantingClass.label.replace(/^./, (c) => c.toUpperCase()),
        color: plantingClass.color,
        count: visible.filter((crown) => crown.planted_by === plantingClass.plantedBy).length,
      }));
      entries.push({
        key: 'unknown',
        label: 'Non estimée',
        color: null,
        count: visible.filter((crown) => !crown.planted_by).length,
      });
      return entries.filter((entry) => entry.count > 0);
    }
  }
}

/**
 * Choix du mode de coloration des couronnes (continent, espèce, date de plantation),
 * flottant dans le coin haut gauche de la carte, avec sa légende repliable.
 */
export function ColorSchemeControl({ crowns, coloring }: { crowns: Crown[]; coloring: CrownColoring }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  useClickOutside(rootRef, () => setMenuOpen(false), menuOpen);

  const current = COLOR_SCHEMES.find((scheme) => scheme.id === coloring.scheme)!;
  const entries = useMemo(() => legendEntries(crowns, coloring), [crowns, coloring]);

  const itemClass =
    'flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left ' +
    'hover:bg-black/[0.05] focus-visible:bg-black/[0.05] focus-visible:outline-none';

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
      className="absolute top-[10px] left-[10px] z-[1000] flex max-w-[calc(100%-20px)] flex-col items-start gap-1.5"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Couleurs : ${current.label}`}
          className={`flex h-7 items-center gap-1 rounded-full pr-1.5 pl-2.5 text-xs ${GLASS} ${PRESSABLE}`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name="palette" className="text-base text-black/60" />
          <span className="text-black/55">Couleurs :</span>
          <span className="font-medium">{current.label}</span>
          <Icon name="expand_more" className="text-base" />
        </button>
        <button
          type="button"
          aria-expanded={legendOpen}
          aria-label={legendOpen ? 'Masquer la légende' : 'Afficher la légende'}
          title={legendOpen ? 'Masquer la légende' : 'Afficher la légende'}
          className={`flex size-7 items-center justify-center rounded-full ${GLASS} ${PRESSABLE}`}
          onClick={() => setLegendOpen(!legendOpen)}
        >
          <Icon name={legendOpen ? 'expand_less' : 'list'} className="text-base" />
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          className={
            'w-[240px] rounded-2xl bg-white/85 p-1.5 shadow-[0_12px_48px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.08] ' +
            'backdrop-blur-2xl backdrop-saturate-[1.8]'
          }
        >
          {COLOR_SCHEMES.map((scheme) => {
            const selected = scheme.id === coloring.scheme;
            return (
              <button
                key={scheme.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={itemClass}
                onClick={() => {
                  setColorScheme(scheme.id);
                  setMenuOpen(false);
                }}
              >
                <Icon name="check" className={`w-5 text-lg text-primary ${selected ? '' : 'invisible'}`} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={`text-sm ${selected ? 'font-medium' : ''}`}>{scheme.label}</span>
                  <small className="text-xs text-black/50">{scheme.hint}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {legendOpen && !menuOpen && entries.length > 0 && (
        <ul
          aria-label={`Légende : ${current.label}`}
          className={`max-h-[min(320px,calc(100vh-200px))] w-[220px] overflow-y-auto rounded-xl p-1 text-xs ${GLASS}`}
        >
          {entries.map((entry) => {
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-black/25"
                  style={entry.color ? { backgroundColor: entry.color } : { boxShadow: 'inset 0 0 0 1.5px #fff' }}
                />
                <span className={`min-w-0 flex-1 truncate ${entry.italic ? 'italic' : ''}`}>{entry.label}</span>
                <span className="shrink-0 text-[10px] text-black/45 tabular-nums">{entry.count}</span>
              </>
            );
            const rowClass = 'flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left';
            return (
              <li key={entry.key}>
                {entry.crown ? (
                  <button
                    type="button"
                    title={`Réf. ${entry.key}`}
                    className={`${rowClass} cursor-pointer hover:bg-black/[0.06] focus-visible:bg-black/[0.06] focus-visible:outline-none`}
                    onClick={() => selectCrown(entry.crown!)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
