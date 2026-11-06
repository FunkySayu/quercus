import type * as L from 'leaflet';
import { type Crown, isIdentified } from '../../models/crown';

// Couleurs moyennement saturées par continent d'origine, utilisées pour teinter
// les couronnes identifiées. "Quercus sp." et les continents inconnus retombent sur le gris.
const CONTINENT_COLORS: Record<string, string> = {
  Europe: '#4C7EA8',
  'Amérique du Nord': '#5B9B5B',
  Mexique: '#B5544A',
  Asie: '#C9A227',
};
const DEFAULT_CROWN_COLOR = '#9AA0A6';
const UNIDENTIFIED_CROWN_COLOR = '#FFFFFF';
const HIDDEN_CROWN_FILL = '#202124';

export function continentColor(continent: string | null | undefined): string {
  return (continent && CONTINENT_COLORS[continent]) || DEFAULT_CROWN_COLOR;
}

/** `selected` : la couronne cliquée/recherchée ; `lowlight` : estompée car d'une autre fiche. */
export type CrownState = 'normal' | 'selected' | 'lowlight';

export function crownStyle(crown: Crown, state: CrownState): L.PathOptions {
  if (crown.hidden) {
    // Couronne masquée (visible seulement connecté) : grisée (voile sombre + contour
    // pointillé), pour qu'on voie qu'elle n'est pas affichée aux visiteurs tout en
    // pouvant la retrouver et la restaurer.
    return {
      color: UNIDENTIFIED_CROWN_COLOR,
      fillColor: HIDDEN_CROWN_FILL,
      weight: state === 'selected' ? 2 : 1.5,
      opacity: state === 'selected' ? 1 : state === 'lowlight' ? 0.25 : 0.6,
      dashArray: '3 4',
      fillOpacity: state === 'lowlight' ? 0.2 : 0.45,
    };
  }
  if (!isIdentified(crown)) {
    // Couronnes LiDAR sans relevé : simple contour discret, pour situer les arbres
    // non encore pointés sans voler la vedette aux fiches. Remplissage quasi
    // transparent mais non nul, pour rester cliquable.
    return {
      color: UNIDENTIFIED_CROWN_COLOR,
      fillColor: UNIDENTIFIED_CROWN_COLOR,
      weight: state === 'selected' ? 3 : 1,
      opacity: state === 'selected' ? 1 : state === 'lowlight' ? 0.12 : 0.3,
      fillOpacity: state === 'selected' ? 0.2 : 0.03,
    };
  }
  const color = continentColor(crown.continent);
  return {
    color: state === 'selected' ? '#FFFFFF' : color,
    fillColor: color,
    weight: state === 'selected' ? 3 : 2,
    opacity: state === 'lowlight' ? 0.3 : 1,
    fillOpacity: state === 'selected' ? 0.6 : state === 'lowlight' ? 0.1 : 0.4,
  };
}

/** Reproduit le tri des références du catalogue (voir `storage._species_sort_key`
 * côté backend) : numérique puis Bis avant Ter, pour que Précédent/Suivant suivent
 * l'ordre du quercitum plutôt qu'un tri alphabétique brut ("10" avant "9"). */
function referenceSortKey(reference: string): [number, number, string] {
  const match = /^(\d+)\s*(Bis|Ter)?$/i.exec(reference.trim());
  if (!match) {
    return [Number.MAX_SAFE_INTEGER, 0, reference];
  }
  const suffix = (match[2] || '').toUpperCase();
  const suffixRank = suffix === 'BIS' ? 1 : suffix === 'TER' ? 2 : 0;
  return [Number(match[1]), suffixRank, ''];
}

export function compareReferences(a: string, b: string): number {
  const [aNumber, aSuffix, aFallback] = referenceSortKey(a);
  const [bNumber, bSuffix, bFallback] = referenceSortKey(b);
  if (aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  if (aSuffix !== bSuffix) {
    return aSuffix - bSuffix;
  }
  return aFallback.localeCompare(bFallback, 'fr');
}

/** Titre du panneau de détail : le nom scientifique prime, avec repli sur les autres champs saisis. */
export function crownTitle(crown: Crown): string {
  if (crown.hidden) {
    return 'Couronne masquée';
  }
  if (!isIdentified(crown)) {
    return 'Couronne non identifiée';
  }
  return crown.nom_scientifique || crown.reference || crown.nom_usage || crown.name || 'Arbre';
}

/** Nom d'usage affiché en sous-titre, sauf s'il fait doublon avec le titre. */
export function crownSubtitle(crown: Crown): string | null {
  if (crown.hidden) {
    return "Non affichée aux visiteurs : elle n'est pas suivie";
  }
  if (!isIdentified(crown)) {
    return 'Arbre détecté par LiDAR, aucun relevé rattaché';
  }
  return crown.nom_usage && crown.nom_usage !== crownTitle(crown) ? crown.nom_usage : null;
}
