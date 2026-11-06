import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { dismissToast, useToast } from '../stores/toast';

/** Icône Material (police chargée dans index.html), par son nom de ligature. */
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`material-icons shrink-0 select-none leading-none ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

/** Couleur via `className` (text-*), primaire par défaut. */
export function Spinner({ size = 24, className = 'text-primary' }: { size?: number; className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="Chargement"
      className={`inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent ${className}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 9)) }}
    />
  );
}

// Classes de boutons, en écho aux variantes Material d'origine.
const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors ' +
  'cursor-pointer disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-primary';
export const buttonClass = {
  /** mat-raised-button color="primary" */
  primary: `${BUTTON_BASE} h-10 px-4 bg-primary text-white shadow hover:bg-primary-dark disabled:shadow-none`,
  /** mat-stroked-button */
  stroked: `${BUTTON_BASE} h-9 px-3 border border-black/15 bg-white text-black/80 hover:bg-black/5`,
  /** mat-button */
  text: `${BUTTON_BASE} h-9 px-3 hover:bg-black/5`,
  /** mat-icon-button */
  icon: `${BUTTON_BASE} size-10 rounded-full hover:bg-black/5`,
};

/** Retour à la carte, en tête des pages secondaires (l'app n'a pas de barre d'en-tête). */
export function BackToMap() {
  return (
    <Link to="/" className={`${buttonClass.text} -ml-3 mb-2 text-black/70`}>
      <Icon name="arrow_back" className="text-xl" />
      Carte
    </Link>
  );
}

/** Lien texte (Tailwind réinitialise le style par défaut des <a>). */
export const linkClass = 'text-primary underline underline-offset-2 hover:text-primary-dark';

/** Ferme un popover sur clic/touche à l'extérieur de `ref`. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  const callback = useRef(onOutside);
  callback.current = onOutside;
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const handler = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback.current();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [ref, active]);
}

/** Hôte de l'unique toast courant (voir stores/toast.ts), en bas de l'écran. */
export function Toaster() {
  const toast = useToast((s) => s.toast);
  if (!toast) {
    return null;
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex min-w-72 max-w-xl items-center gap-4 rounded-md bg-neutral-800 px-4 py-3 text-sm text-white shadow-lg"
      >
        <span className="flex-1">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            className="cursor-pointer font-medium uppercase tracking-wide text-pink-300 hover:text-pink-200"
            onClick={() => {
              dismissToast(toast.id);
              toast.onAction?.();
            }}
          >
            {toast.action}
          </button>
        )}
      </div>
    </div>
  );
}

/** Option sur deux lignes : nom scientifique en gras, puis nom commun + référence. */
export interface AutocompleteOption {
  key: string;
  /** Texte injecté dans le champ quand l'option est choisie. */
  value: string;
  primary: string;
  secondary: string;
}

interface AutocompleteProps {
  value: string;
  onChange: (text: string) => void;
  options: AutocompleteOption[];
  onSelect?: (option: AutocompleteOption) => void;
  onBlur?: () => void;
  placeholder?: string;
  label?: string;
  id?: string;
  /** Classes de l'élément <input>. */
  inputClassName?: string;
  className?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Ouvre les suggestions au-dessus du champ (champ placé en bas de l'écran). */
  listAbove?: boolean;
  autoFocus?: boolean;
}

/**
 * Champ texte libre avec suggestions (équivalent mat-autocomplete) : la saisie reste
 * libre, choisir une suggestion remplace le texte par sa `value` puis notifie `onSelect`.
 */
export function Autocomplete({
  value,
  onChange,
  options,
  onSelect,
  onBlur,
  placeholder,
  label,
  id,
  inputClassName = '',
  className = '',
  prefix,
  suffix,
  listAbove = false,
  autoFocus = false,
}: AutocompleteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen, active, setActive] = useOpenState();
  const listId = `${id ?? 'autocomplete'}-listbox`;

  useClickOutside(rootRef, () => setOpen(false), open);

  useEffect(() => {
    if (active >= 0) {
      listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  const choose = (option: AutocompleteOption) => {
    onChange(option.value);
    onSelect?.(option);
    setOpen(false);
  };

  const showList = open && options.length > 0;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-black/70">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {prefix}
        <input
          id={id}
          type="text"
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          value={value}
          placeholder={placeholder}
          className={inputClassName}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!showList) {
                setOpen(true);
                return;
              }
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((active + step + options.length) % options.length);
            } else if (event.key === 'Enter' && showList && active >= 0 && options[active]) {
              event.preventDefault();
              choose(options[active]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {suffix}
      </div>
      {showList && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={
            'absolute inset-x-0 z-[1100] max-h-72 overflow-y-auto rounded-md bg-white py-1 text-black shadow-lg ring-1 ring-black/10 ' +
            (listAbove ? 'bottom-full mb-1' : 'top-full mt-1')
          }
        >
          {options.map((option, index) => (
            <li
              key={option.key}
              role="option"
              aria-selected={index === active}
              className={`cursor-pointer px-4 py-2 leading-snug ${index === active ? 'bg-black/5' : 'hover:bg-black/5'}`}
              // mousedown plutôt que click : garde le focus dans le champ.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <strong className="block font-semibold">{option.primary}</strong>
              <span className="text-sm text-black/70">{option.secondary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useOpenState(): [boolean, (open: boolean) => void, number, (index: number) => void] {
  const [open, setOpenRaw] = useState(false);
  const [active, setActive] = useState(-1);
  const setOpen = (next: boolean) => {
    setOpenRaw(next);
    if (!next) {
      setActive(-1);
    }
  };
  return [open, setOpen, active, setActive];
}
