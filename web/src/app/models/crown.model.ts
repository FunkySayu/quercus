/** Rattachement d'un relevé à sa couronne, calculé hors-ligne par tools/lidar_crowns.py. */
export type ReadingMatch = 'inside' | 'snapped' | 'unmatched';

/** Un relevé GPS (ligne de trees.csv) porté par une couronne. */
export interface CrownReading {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  reference: string | null;
  name: string | null;
  created_at: string;
  /** null : relevé saisi après le dernier calcul LiDAR. */
  match: ReadingMatch | null;
  dist_to_top_m: number | null;
}

/**
 * Unité affichée par l'UI : un arbre = un polygone (voir backend app/crowns.py).
 * - `lidar` : couronne détectée sur le MNH LiDAR, avec ou sans relevé rattaché ;
 * - `gps` : cercle de 2 m autour d'un relevé qu'aucune couronne n'identifie de façon fiable.
 * Les champs espèce viennent de la fiche catalogue de `reference` (null si aucun relevé).
 */
export interface Crown {
  id: string;
  source: 'lidar' | 'gps';
  crown_id: number | null;
  height_m: number | null;
  diameter_m: number | null;
  area_m2: number | null;
  planted_after: number | null;
  planted_by: number | null;
  /** [longitude, latitude] du sommet de la couronne (ou du relevé pour un cercle GPS). */
  top: [number, number] | null;
  reference: string | null;
  name: string | null;
  nom_scientifique: string | null;
  nom_usage: string | null;
  origine: string | null;
  statut_uicn: string | null;
  statut_uicn_annee: string | null;
  statut_uicn_url: string | null;
  wikipedia_url: string | null;
  powo_url: string | null;
  description: string | null;
  continent: string | null;
  /** Couronne qu'on ne suit pas ("supprimée" depuis l'app, marqueur `hidden` dans le
   * GeoJSON) : seulement renvoyée aux utilisateurs connectés, pour pouvoir la restaurer.
   * Toujours sans relevé (les siens retombent en cercles GPS côté backend). */
  hidden: boolean;
  /** Relevés rattachés, du plus récent au plus ancien. Vide : couronne non identifiée. */
  readings: CrownReading[];
}

export type CrownFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Crown>;

export interface CrownCollection extends GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, Crown> {
  features: CrownFeature[];
}

/** Une couronne est "identifiée" dès qu'au moins un relevé (donc une fiche) y est rattaché. */
export function isIdentified(crown: Crown): boolean {
  return !crown.hidden && crown.readings.length > 0;
}

/** Seules les couronnes LiDAR peuvent être masquées (un cercle GPS n'existe que par son relevé). */
export function canHide(crown: Crown): boolean {
  return crown.source === 'lidar' && crown.crown_id !== null;
}

/** Date du relevé le plus récent, ou null pour une couronne non identifiée. */
export function lastReadingDate(crown: Crown): string | null {
  return crown.readings[0]?.created_at ?? null;
}

/** Meilleure précision GPS parmi les relevés rattachés. */
export function bestAccuracy(crown: Crown): number | null {
  return crown.readings.length ? Math.min(...crown.readings.map((reading) => reading.accuracy)) : null;
}

/**
 * Intervalle de plantation estimé d'après les photos aériennes datées (voir
 * backend/tools/crown_history.py) : null si non estimé (cercle GPS, ou arbre
 * jamais détecté durablement).
 */
export function plantingLabel(crown: Crown): string | null {
  if (!crown.planted_by) {
    return null;
  }
  return crown.planted_after
    ? `entre ${crown.planted_after} et ${crown.planted_by}`
    : `avant ${crown.planted_by}`;
}
