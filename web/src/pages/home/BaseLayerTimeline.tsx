import { Fragment, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon, useClickOutside } from '../../components/ui';
import { BASE_LAYER_GROUPS, findBaseLayer, formatLayerDate, type BaseLayerOption } from './base-layers';

interface Props {
  baseLayerId: string;
  onSelect: (id: string) => void;
  /** Le panneau de détail occupe le bord droit (desktop) ou le bas (mobile) de la carte. */
  besidePanel: boolean;
  lidarOverlayAvailable: boolean;
  lidarOverlayVisible: boolean;
  onToggleLidarOverlay: () => void;
  /** Contenu optionnel empilé au-dessus de la frise (barre d'outils d'édition). */
  toolbar?: ReactNode;
}

/** Échelle de la frise : linéaire, une graduation par an. */
const PX_PER_YEAR = 56;
/** Écart minimal entre deux marqueurs d'images proches (ex. les trois de 2023). */
const MIN_MARKER_GAP = 18;
/** Années vides affichées avant la première et après la dernière image. */
const PAD_YEARS = 4;
/** Déplacement au-delà duquel un appui sur la frise devient un glissement. */
const DRAG_THRESHOLD = 6;
/** Courbe « ressort » à la iOS pour le défilement de la frise. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Fondu horizontal des bords de la frise. */
const EDGE_FADE = 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)';
/** Années lisibles directement sur la photo aérienne, sans fond. */
const ON_MAP_TEXT = { textShadow: '0 1px 2px rgb(0 0 0 / 0.7), 0 0 6px rgb(0 0 0 / 0.35)' };

/** Matériau « verre dépoli » commun à chaque contrôle flottant. */
const GLASS =
  'bg-white/80 text-black/85 shadow-[0_2px_10px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06] ' +
  'backdrop-blur-xl backdrop-saturate-[1.8]';
/** Gabarit commun aux trois pastilles sous la frise (date, fond, résolution) ; largeur à part. */
const PILL = 'flex h-6 shrink-0 items-center justify-center rounded-full text-[11px]';
const PRESSABLE =
  'cursor-pointer transition hover:bg-white/95 active:scale-95 ' +
  'focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none';

/** "2023-05-29" → 2023.41 ; mois seul → milieu du mois ; année seule → milieu d'année. */
function decimalYear(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  if (!month) return year + 0.5;
  return year + (month - 1 + (day ? (day - 0.5) / 31 : 0.5)) / 12;
}

/** Positions (px) des images sur une frise linéaire, décalées si elles se chevauchent. */
function layoutTimeline(steps: BaseLayerOption[]) {
  const years = steps.map((o) => decimalYear(o.date!));
  const startYear = Math.floor(years[0]) - PAD_YEARS;
  const endYear = Math.floor(years[years.length - 1]) + 1 + PAD_YEARS;
  const positions: number[] = [];
  years.forEach((y, i) => {
    const x = (y - startYear) * PX_PER_YEAR;
    positions.push(i === 0 ? x : Math.max(x, positions[i - 1] + MIN_MARKER_GAP));
  });
  const yearMarks = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  return { positions, startYear, yearMarks, width: (endYear - startYear) * PX_PER_YEAR };
}

/**
 * Sélecteur de fond de carte, flottant en bas de la carte (voir base-layers.ts) :
 * frise chronologique linéaire des images du groupe courant (Photos / Technique),
 * à faire défiler par les chevrons, un clic sur un marqueur, un glissement ou les
 * flèches du clavier ; en dessous, la date, le nom du fond (menu de tous les fonds)
 * et sa résolution.
 */
export function BaseLayerTimeline({
  baseLayerId,
  onSelect,
  besidePanel,
  lidarOverlayAvailable,
  lidarOverlayVisible,
  onToggleLidarOverlay,
  toolbar,
}: Props) {
  const current = findBaseLayer(baseLayerId);
  // Ordre chronologique réel (une année seule compte pour le milieu de l'année, alors
  // que le tri textuel des groupes la place avant les dates complètes de la même année).
  const steps = useMemo(
    () =>
      BASE_LAYER_GROUPS.find((g) => g.group === current.group)!
        .options.filter((o) => o.date)
        .sort((a, b) => decimalYear(a.date!) - decimalYear(b.date!)),
    [current.group],
  );
  const { positions, startYear, yearMarks, width } = useMemo(() => layoutTimeline(steps), [steps]);
  const index = Math.max(0, steps.findIndex((o) => o.id === current.id));

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  // --- Glissement de la frise --------------------------------------------------
  const drag = useRef<{ startX: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragDx, setDragDx] = useState(0);
  const dragging = drag.current?.active ?? false;

  /** Image la plus proche du centre de la frise (pendant un glissement). */
  const nearest = (x: number) =>
    positions.reduce((best, p, i) => (Math.abs(p - x) < Math.abs(positions[best] - x) ? i : best), 0);
  const highlighted = dragging ? nearest(positions[index] - dragDx) : index;

  const go = (i: number) => {
    const target = steps[Math.max(0, Math.min(steps.length - 1, i))];
    if (target && target.id !== current.id) {
      onSelect(target.id);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      drag.current = { startX: event.clientX, active: false };
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    let dx = event.clientX - state.startX;
    if (!state.active && Math.abs(dx) > DRAG_THRESHOLD) {
      state.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (state.active) {
      // Résistance élastique au-delà de la première / dernière image.
      const max = positions[index] - positions[0];
      const min = positions[index] - positions[positions.length - 1];
      if (dx > max) dx = max + (dx - max) / 3;
      if (dx < min) dx = min + (dx - min) / 3;
      setDragDx(dx);
    }
  };
  const endDrag = (commit: boolean) => {
    if (drag.current?.active) {
      suppressClick.current = true;
      if (commit) {
        go(highlighted);
      }
    }
    drag.current = null;
    setDragDx(0);
  };

  const highlightedYear = steps[highlighted]?.date?.slice(0, 4);
  /** Même défilement pour la ligne des années et la règle. */
  const trackStyle = {
    width,
    transform: `translateX(${-positions[index] + dragDx}px)`,
    transition: dragging ? 'none' : `transform 450ms ${EASE}`,
  };

  return (
    <div
      ref={menuRef}
      onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
      className={
        'pointer-events-none absolute bottom-6 left-0 z-[1000] flex flex-col items-center gap-1.5 px-3 ' +
        (besidePanel ? 'right-[360px] max-sm:hidden' : 'right-0')
      }
    >
      {/* Menu ouvert au-dessus de tout le sélecteur, pour ne pas masquer la frise. */}
      {menuOpen && (
        <LayerMenu
          baseLayerId={baseLayerId}
          onSelect={(id) => {
            onSelect(id);
            setMenuOpen(false);
          }}
          lidarOverlayAvailable={lidarOverlayAvailable}
          lidarOverlayVisible={lidarOverlayVisible}
          onToggleLidarOverlay={onToggleLidarOverlay}
        />
      )}

      {toolbar && <div className="mb-1.5 flex max-w-full justify-center">{toolbar}</div>}

      {/* Frise : années au-dessus (sans fond), puis la règle sur son bandeau, centrée sur
          l'image courante ; les chevrons sont alignés sur la ligne de la règle. */}
      <div className="pointer-events-auto grid w-[min(460px,100%)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1">
        <div
          aria-hidden="true"
          className="relative col-start-2 row-start-1 h-4 overflow-hidden select-none"
          style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
        >
          <div className="absolute inset-y-0 left-1/2" style={trackStyle}>
            {yearMarks.map((y) => (
              <span
                key={y}
                className={
                  'absolute top-0 -translate-x-1/2 text-[11px] leading-4 text-white tabular-nums transition-[font-weight] duration-300 ' +
                  (String(y) === highlightedYear ? 'font-bold' : 'font-medium opacity-85')
                }
                style={{ left: (y - startYear) * PX_PER_YEAR, ...ON_MAP_TEXT }}
              >
                {y}
              </span>
            ))}
          </div>
        </div>

        <ChevronButton className="col-start-1 row-start-2" icon="chevron_left" label="Image précédente" disabled={index <= 0} onClick={() => go(index - 1)} />

        <div
          role="group"
          tabIndex={0}
          aria-label="Frise chronologique des fonds de carte (flèches gauche/droite)"
          className={
            'relative col-start-2 row-start-2 h-5 min-w-0 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing ' +
            'bg-white/60 backdrop-blur-md focus-visible:outline-none'
          }
          style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
          onClickCapture={(event) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              event.stopPropagation();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') go(index - 1);
            if (event.key === 'ArrowRight') go(index + 1);
          }}
        >
          <div className="absolute inset-y-0 left-1/2" style={trackStyle}>
            {/* Rail + graduations trimestrielles et annuelles, centrées sur le rail. */}
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/25" />
            <div
              className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2"
              style={{
                backgroundImage: `repeating-linear-gradient(to right, rgb(0 0 0 / 0.2) 0 1px, transparent 1px ${PX_PER_YEAR / 4}px)`,
              }}
            />
            {yearMarks.map((y) => (
              <span
                key={y}
                className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-black/45"
                style={{ left: (y - startYear) * PX_PER_YEAR }}
              />
            ))}

            {/* Une pastille par image disponible. */}
            {steps.map((option, i) => (
              <button
                key={option.id}
                type="button"
                tabIndex={-1}
                title={`${option.label} · ${formatLayerDate(option)}`}
                aria-label={`${option.label} (${formatLayerDate(option)})`}
                aria-current={i === index || undefined}
                className="group absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center"
                style={{ left: positions[i] }}
                onClick={() => go(i)}
              >
                <span
                  className={
                    'block rounded-full transition-all duration-300 ' +
                    (i === highlighted
                      ? 'size-3.5 bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.35)] ring-2 ring-white'
                      : 'size-2.5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] ring-1 ring-black/30 group-hover:scale-125')
                  }
                />
              </button>
            ))}
          </div>
        </div>

        <ChevronButton
          className="col-start-3 row-start-2"
          icon="chevron_right"
          label="Image suivante"
          disabled={index >= steps.length - 1}
          onClick={() => go(index + 1)}
        />
      </div>

      {/* Date · nom (menu) · résolution, chacun sur son propre fond. */}
      <div className="pointer-events-auto flex max-w-full items-center gap-2">
        <InfoPill label="Date de prise de vue" value={formatLayerDate(current)} />

        <div>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Fond de carte : ${current.label}`}
            className={`${PILL} w-[188px] gap-0.5 pr-1.5 pl-2.5 font-medium max-sm:w-[156px] ${GLASS} ${PRESSABLE}`}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span className="truncate">{current.label}</span>
            <Icon name="expand_more" className="text-base text-black/85" />
          </button>
        </div>

        <InfoPill label="Résolution au sol" value={current.resolution ?? 'n.c.'} />
      </div>
    </div>
  );
}

/** Date / résolution : même gabarit que le sélecteur de fond. */
function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      title={label}
      className={`${PILL} w-[88px] tabular-nums max-sm:w-[76px] ${GLASS}`}
    >
      <span className="sr-only">{label} : </span>
      {value}
    </span>
  );
}

function ChevronButton({
  className,
  icon,
  label,
  disabled,
  onClick,
}: {
  className: string;
  icon: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={
        `${className} flex size-6 shrink-0 items-center justify-center rounded-full ${GLASS} ${PRESSABLE} ` +
        'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/80 disabled:active:scale-100'
      }
      onClick={onClick}
    >
      <Icon name={icon} className="text-base" />
    </button>
  );
}

/** Menu de tous les fonds, ouvert vers le haut au-dessus du sélecteur. */
function LayerMenu({
  baseLayerId,
  onSelect,
  lidarOverlayAvailable,
  lidarOverlayVisible,
  onToggleLidarOverlay,
}: {
  baseLayerId: string;
  onSelect: (id: string) => void;
  lidarOverlayAvailable: boolean;
  lidarOverlayVisible: boolean;
  onToggleLidarOverlay: () => void;
}) {
  const itemClass =
    'flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left ' +
    'hover:bg-black/[0.05] focus-visible:bg-black/[0.05] focus-visible:outline-none';
  return (
    <div
      role="menu"
      className={
        'pointer-events-auto absolute bottom-full left-1/2 mb-2 max-h-[calc(100vh-220px)] w-[min(320px,calc(100vw-24px))] -translate-x-1/2 ' +
        'overflow-y-auto rounded-2xl bg-white/85 p-1.5 shadow-[0_12px_48px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.08] ' +
        'backdrop-blur-2xl backdrop-saturate-[1.8]'
      }
    >
      {BASE_LAYER_GROUPS.map((group, index) => (
        <Fragment key={group.group}>
          {index > 0 && <hr className="mx-2.5 my-1.5 border-black/10" />}
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.04em] text-black/45 uppercase">
            {group.label}
          </div>
          {group.options.map((option) => {
            const selected = option.id === baseLayerId;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={itemClass}
                onClick={() => onSelect(option.id)}
              >
                <Icon name="check" className={`w-5 text-lg text-primary ${selected ? '' : 'invisible'}`} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={`text-sm ${selected ? 'font-medium' : ''}`}>{option.label}</span>
                  <small className="text-xs text-black/50">
                    {formatLayerDate(option)} · {option.hint}
                  </small>
                </span>
              </button>
            );
          })}
          {group.group === 'technique' && lidarOverlayAvailable && (
            // Interrupteur : le menu reste ouvert pour comparer avec/sans.
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={lidarOverlayVisible}
              className={itemClass}
              onClick={onToggleLidarOverlay}
            >
              <span className="w-5" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-sm">Rattachement GPS</span>
                <small className="text-xs text-black/50">Diagnostic · relevés bruts → couronnes</small>
              </span>
              <span
                className={`relative h-[22px] w-9 shrink-0 rounded-full transition-colors duration-200 ${lidarOverlayVisible ? 'bg-primary' : 'bg-black/15'}`}
              >
                <span
                  className="absolute top-0.5 left-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200"
                  style={{ transform: lidarOverlayVisible ? 'translateX(14px)' : undefined, transitionTimingFunction: EASE }}
                />
              </span>
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}
