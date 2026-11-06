import { create } from 'zustand';

/**
 * Outils d'édition de la carte (barre au-dessus de la frise, utilisateurs connectés) :
 * - `cursor` : sélection classique (ouvre le panneau de détail) ;
 * - `pipette` : prélève la fiche d'une couronne identifiée dans la palette ;
 * - `paint` : applique la fiche de la palette à la couronne cliquée ;
 * - `erase` : retire une fiche posée à la peinture (jamais un relevé de terrain) ;
 * - `delete` : masque la couronne cliquée (voir `setCrownHidden`).
 */
export type EditTool = 'cursor' | 'pipette' | 'paint' | 'erase' | 'delete';

/** Une action annulable : `undo` puis `redo` doivent pouvoir s'enchaîner indéfiniment. */
export interface EditAction {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 50;

interface EditToolsState {
  tool: EditTool;
  /** Référence catalogue de la fiche choisie dans la palette (null : aucune). */
  paletteReference: string | null;
  past: EditAction[];
  future: EditAction[];
  /** Une annulation/restauration est en cours : on n'en enchaîne pas une autre. */
  busy: boolean;
}

export const useEditTools = create<EditToolsState>()(() => ({
  tool: 'cursor',
  paletteReference: null,
  past: [],
  future: [],
  busy: false,
}));

export function setTool(tool: EditTool): void {
  useEditTools.setState({ tool });
}

export function setPaletteReference(reference: string | null): void {
  useEditTools.setState({ paletteReference: reference });
}

/** Enregistre une action déjà effectuée ; vide la pile de rétablissement. */
export function pushAction(action: EditAction): void {
  useEditTools.setState((state) => ({ past: [...state.past, action].slice(-MAX_HISTORY), future: [] }));
}

async function replay(from: 'past' | 'future'): Promise<EditAction | null> {
  const state = useEditTools.getState();
  const stack = state[from];
  const action = stack[stack.length - 1];
  if (!action || state.busy) {
    return null;
  }
  useEditTools.setState({ busy: true });
  try {
    await (from === 'past' ? action.undo() : action.redo());
    useEditTools.setState((s) =>
      from === 'past'
        ? { past: s.past.slice(0, -1), future: [...s.future, action] }
        : { future: s.future.slice(0, -1), past: [...s.past, action] },
    );
    return action;
  } finally {
    useEditTools.setState({ busy: false });
  }
}

/** Annule la dernière action ; rejette si l'appel backend échoue (l'historique reste intact). */
export const undo = () => replay('past');
export const redo = () => replay('future');
