import type * as L from 'leaflet';
import { type Crown, isIdentified, plantingLabel } from '../../models/crown';
import type { ColorScheme } from '../../stores/color-scheme';
import { speciesColor } from './species-colors';

// Couleurs moyennement saturées par continent d'origine, utilisées pour teinter
// les couronnes identifiées. Les continents inconnus retombent sur le gris.
export const CONTINENT_COLORS: Record<string, string> = {
  Europe: '#4C7EA8',
  'Amérique du Nord': '#5B9B5B',
  Mexique: '#B5544A',
  Asie: '#C9A227',
};
export const DEFAULT_CROWN_COLOR = '#9AA0A6';
const UNIDENTIFIED_CROWN_COLOR = '#FFFFFF';
const HIDDEN_CROWN_FILL = '#202124';

export function continentColor(continent: string | null | undefined): string {
  return (continent && CONTINENT_COLORS[continent]) || DEFAULT_CROWN_COLOR;
}

// --- Date de plantation ------------------------------------------------------

/** Rampe séquentielle claire (colorcet `bmy`, tronquée côté sombre pour rester lisible
 * sur les photos aériennes) : violet = planté anciennement, jaune = récemment. */
const PLANTING_RAMP = ['#97038F', '#CF0081', '#FA2A6F', '#FF6956', '#FFA031', '#FFCB1C', '#FFEF22'];

function rampColor(t: number): string {
  const position = Math.min(1, Math.max(0, t)) * (PLANTING_RAMP.length - 1);
  const index = Math.min(PLANTING_RAMP.length - 2, Math.floor(position));
  const [a, b] = [PLANTING_RAMP[index], PLANTING_RAMP[index + 1]];
  const mix = (offset: number) => {
    const from = parseInt(a.slice(offset, offset + 2), 16);
    const to = parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * (position - index))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

export interface PlantingClass {
  plantedBy: number;
  label: string;
  color: string;
}

/**
 * Classes de plantation présentes sur la carte, de la plus ancienne à la plus récente.
 * Les estimations tombent sur les millésimes des photos aériennes (une poignée
 * d'intervalles) : la couleur suit le rang de l'intervalle plutôt que l'année, sinon
 * les millésimes rapprochés (2013, 2014, 2015…) seraient indiscernables.
 */
export function buildPlantingClasses(crowns: Crown[]): PlantingClass[] {
  const byYear = new Map<number, string>();
  for (const crown of crowns) {
    if (crown.planted_by && !byYear.has(crown.planted_by)) {
      byYear.set(crown.planted_by, plantingLabel(crown)!);
    }
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((plantedBy, index) => ({
    plantedBy,
    label: byYear.get(plantedBy)!,
    color: rampColor(years.length > 1 ? index / (years.length - 1) : 1),
  }));
}

// --- Coloration --------------------------------------------------------------

/** Mode de coloration choisi, et ce qu'il faut pour l'appliquer. */
export interface CrownColoring {
  scheme: ColorScheme;
  plantingClasses: PlantingClass[];
}

/** Teinte d'une couronne dans le mode courant, ou null si elle n'en a pas (gris). */
export function crownColor(crown: Crown, coloring: CrownColoring): string | null {
  switch (coloring.scheme) {
    case 'continent':
      return (crown.continent && CONTINENT_COLORS[crown.continent]) || null;
    case 'species':
      return speciesColor(crown.reference);
    case 'planting':
      return coloring.plantingClasses.find((c) => c.plantedBy === crown.planted_by)?.color ?? null;
  }
}

/** Pastille d'une fiche du catalogue (barre d'outils d'édition) : couleur d'espèce en
 * mode « Espèce », de continent sinon (la date de plantation est propre à chaque arbre). */
export function speciesSwatchColor(
  species: { reference: string; continent: string | null },
  scheme: ColorScheme,
): string {
  return (scheme === 'species' && speciesColor(species.reference)) || continentColor(species.continent);
}

/** `selected` : la couronne cliquée/recherchée ; `lowlight` : estompée car d'une autre fiche. */
export type CrownState = 'normal' | 'selected' | 'lowlight';

export function crownStyle(crown: Crown, state: CrownState, coloring: CrownColoring): L.PathOptions {
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
    // En mode « Plantation », la date estimée vaut aussi pour elles : contour teinté.
    const dated = coloring.scheme === 'planting' ? crownColor(crown, coloring) : null;
    if (dated) {
      return {
        color: state === 'selected' ? '#FFFFFF' : dated,
        fillColor: dated,
        weight: state === 'selected' ? 3 : 1.5,
        opacity: state === 'selected' ? 1 : state === 'lowlight' ? 0.2 : 0.75,
        fillOpacity: state === 'selected' ? 0.3 : state === 'lowlight' ? 0.03 : 0.12,
      };
    }
    return {
      color: UNIDENTIFIED_CROWN_COLOR,
      fillColor: UNIDENTIFIED_CROWN_COLOR,
      weight: state === 'selected' ? 3 : 1,
      opacity: state === 'selected' ? 1 : state === 'lowlight' ? 0.12 : 0.3,
      fillOpacity: state === 'selected' ? 0.2 : 0.03,
    };
  }
  const color = crownColor(crown, coloring) ?? DEFAULT_CROWN_COLOR;
  return {
    color: state === 'selected' ? '#FFFFFF' : color,
    fillColor: color,
    weight: state === 'selected' ? 3 : 2,
    opacity: state === 'lowlight' ? 0.3 : 1,
    fillOpacity: state === 'selected' ? 0.6 : state === 'lowlight' ? 0.1 : 0.4,
  };
}

/** Survol : contour plus épais et opaque, remplissage renforcé, quel que soit l'état de base. */
export function crownHoverStyle(style: L.PathOptions): L.PathOptions {
  return {
    ...style,
    weight: (style.weight ?? 1) + 1,
    opacity: 1,
    fillOpacity: Math.min(1, (style.fillOpacity ?? 0) + 0.2),
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
