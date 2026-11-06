import { Fragment, useRef, useState } from 'react';
import { Icon, useClickOutside } from '../../components/ui';
import { BASE_LAYER_GROUPS, findBaseLayer, formatLayerDate } from './base-layers';

interface Props {
  baseLayerId: string;
  onSelect: (id: string) => void;
  /** Le panneau de détail occupe le bord droit (desktop) : on se décale à sa gauche. */
  besidePanel: boolean;
  lidarOverlayAvailable: boolean;
  lidarOverlayVisible: boolean;
  onToggleLidarOverlay: () => void;
}

/** Sélecteur de fond de carte, en haut à droite (voir base-layers.ts). */
export function BaseLayerPicker({
  baseLayerId,
  onSelect,
  besidePanel,
  lidarOverlayAvailable,
  lidarOverlayVisible,
  onToggleLidarOverlay,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useClickOutside(rootRef, () => setOpen(false), open);

  return (
    <div
      ref={rootRef}
      className={`absolute top-2.5 z-[1000] ${besidePanel ? 'right-[370px] max-sm:right-2.5' : 'right-2.5'}`}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <button
        type="button"
        aria-label="Choisir le fond de carte"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-white/95 pr-1 pl-3 text-sm font-medium text-black/85 shadow-[0_1px_4px_rgba(0,0,0,0.3)] hover:bg-white"
        onClick={() => setOpen(!open)}
      >
        <Icon name="layers" className="text-xl" />
        <span className="max-sm:hidden">{findBaseLayer(baseLayerId).label}</span>
        <Icon name="arrow_drop_down" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 max-h-[calc(100vh-140px)] w-max max-w-[calc(100vw-20px)] overflow-y-auto rounded-md bg-white py-2 shadow-lg ring-1 ring-black/10"
        >
          {BASE_LAYER_GROUPS.map((group, index) => (
            <Fragment key={group.group}>
              {index > 0 && <hr className="my-2 border-black/10" />}
              <div className="px-4 pt-2 pb-1 text-xs font-medium tracking-[0.06em] text-black/60 uppercase">
                {group.label}
              </div>
              {group.options.map((option) => (
                <MenuItem
                  key={option.id}
                  icon={option.id === baseLayerId ? 'radio_button_checked' : 'radio_button_unchecked'}
                  label={option.label}
                  hint={`${formatLayerDate(option)} · ${option.hint}`}
                  onClick={() => {
                    onSelect(option.id);
                    setOpen(false);
                  }}
                />
              ))}
              {group.group === 'technique' && lidarOverlayAvailable && (
                // Case à cocher : le menu reste ouvert pour comparer avec/sans.
                <MenuItem
                  icon={lidarOverlayVisible ? 'check_box' : 'check_box_outline_blank'}
                  label="Rattachement GPS"
                  hint="Diagnostic · relevés bruts → couronnes"
                  onClick={onToggleLidarOverlay}
                />
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick }: { icon: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full cursor-pointer items-center gap-4 px-4 py-2 text-left hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none"
      onClick={onClick}
    >
      <Icon name={icon} className="text-black/60" />
      <span className="flex flex-col leading-tight">
        <span>{label}</span>
        <small className="text-black/60">{hint}</small>
      </span>
    </button>
  );
}
