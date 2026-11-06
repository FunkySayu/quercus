import * as L from 'leaflet';

// Fonds de carte proposés dans le sélecteur en haut à droite de la carte, en deux
// groupes ("Photos" / "Technique") triés du plus récent au plus ancien.
//
// Les dates sont celles relevées AU QUERCITUM (le site de l'app) — elles varient
// ailleurs selon les dalles/vols :
// - IGN : graphes de mosaïquage WFS (ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE.*), catalogue
//   des clichés (pva:image) et métadonnées LiDAR HD (IGNF_LIDAR-HD_METADONNEE).
// - Esri : un relevé par capture distincte trouvée dans l'historique Wayback
//   (métadonnées de chaque release), avec le n° de release qui la sert.
// Seules les couches couvrant effectivement le site ont été retenues (les Pléiades,
// THR, Ortho-Express 2024/2025, 1980-1995… n'ont pas de données ici). Les doublons
// visuels (Ortho-Express 2023 et ASP PAC 2024 = vols IGN 2023) et la SPOT (1,5 m)
// ont été écartés.

export type BaseLayerGroup = 'photo' | 'technique';

export interface BaseLayerOption {
  id: string;
  group: BaseLayerGroup;
  label: string;
  /** Résolution / nature de la source. */
  hint: string;
  /** Date de prise de vue au quercitum (AAAA, AAAA-MM ou AAAA-MM-JJ), null si non publiée. */
  date: string | null;
  /** Date estimée (non publiée par la source) : affichée « ≈ », triée comme une vraie date. */
  dateEstimated?: boolean;
  create: () => L.Layer;
}

/** Zoom max de la carte : au-delà du zoom natif des tuiles, Leaflet agrandit. */
export const MAP_MAX_ZOOM = 22;

const IGN_ATTRIBUTION =
  '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> &mdash; Géoplateforme';
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Vantor, Earthstar Geographics, and the GIS User Community';

function ignWmts(
  layer: string,
  tileMatrixSet: string,
  options: { format?: string; style?: string; opacity?: number } = {},
): L.TileLayer {
  const [, minZoom, maxNativeZoom] = tileMatrixSet.split('_').map(Number);
  const url =
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    `&LAYER=${layer}&STYLE=${options.style ?? 'normal'}&FORMAT=${options.format ?? 'image/jpeg'}` +
    `&TILEMATRIXSET=${tileMatrixSet}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  return L.tileLayer(url, {
    attribution: IGN_ATTRIBUTION,
    minZoom,
    maxNativeZoom,
    maxZoom: MAP_MAX_ZOOM,
    opacity: options.opacity ?? 1,
  });
}

/** Capture Esri figée d'une release Wayback (le serveur redirige vers la release qui porte la tuile). */
function esriWayback(release: number): L.TileLayer {
  return L.tileLayer(
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/{z}/{y}/{x}`,
    { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 19, maxZoom: MAP_MAX_ZOOM },
  );
}

/** BD ORTHO IGN la plus récente, servie en fond sous les couches à couverture partielle. */
function bdOrthoFallback(): L.TileLayer {
  return ignWmts('ORTHOIMAGERY.ORTHOPHOTOS', 'PM_0_19');
}

const OPTIONS: BaseLayerOption[] = [
  // --- Photos ------------------------------------------------------------------
  {
    id: 'ign-pcrs',
    group: 'photo',
    label: 'PCRS 5 cm (Vienne)',
    hint: 'Syndicat Énergies Vienne, la plus nette',
    // Date non publiée par le producteur (graphe PCRS ANCT : date_livraison nulle) ;
    // estimée à 2023 par comparaison visuelle avec les millésimes datés.
    date: '2023',
    dateEstimated: true,
    // Pas de pyramide Web Mercator pour le PCRS (Lambert 93 seulement) : passage par
    // le WMS raster, rendu à la volée. Couverture partielle → BD ORTHO en dessous.
    create: () =>
      L.layerGroup([
        bdOrthoFallback(),
        L.tileLayer.wms('https://data.geopf.fr/wms-r', {
          layers: 'PCRS.LAMB93',
          format: 'image/jpeg',
          version: '1.3.0',
          attribution: IGN_ATTRIBUTION,
          maxZoom: MAP_MAX_ZOOM,
          minZoom: 14,
        }),
      ]),
  },
  {
    id: 'ign-express-2026',
    group: 'photo',
    label: 'IGN Ortho-Express 2026',
    hint: 'Photo aérienne, mosaïque rapide',
    date: '2026',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.RVB-EXPRESS.2026', 'PM_0_19'),
  },
  {
    id: 'esri-2025',
    group: 'photo',
    label: 'Satellite Esri 2025',
    hint: 'Vantor WorldView-2, 50 cm',
    date: '2025-08-15',
    create: () => esriWayback(22869),
  },
  {
    id: 'esri-2023',
    group: 'photo',
    label: 'Satellite Esri 2023',
    hint: 'Maxar, 31 cm',
    date: '2023-07-20',
    create: () => esriWayback(60013),
  },
  {
    id: 'ign-ortho',
    group: 'photo',
    label: 'IGN BD ORTHO 2023',
    hint: 'Photo aérienne, 20 cm',
    date: '2023-05-29',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2023', 'PM_6_19'),
  },
  {
    id: 'esri-2021',
    group: 'photo',
    label: 'Satellite Esri 2021',
    hint: 'Maxar, 50 cm',
    date: '2021-09-01',
    create: () => esriWayback(16245),
  },
  {
    id: 'ign-2020',
    group: 'photo',
    label: 'IGN BD ORTHO 2020',
    hint: 'Photo aérienne, 20 cm',
    date: '2020-07-18',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2020', 'PM_6_19'),
  },
  {
    id: 'ign-2017',
    group: 'photo',
    label: 'IGN BD ORTHO 2017',
    hint: 'Photo aérienne, automne',
    date: '2017-10-14',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2017', 'PM_0_18'),
  },
  {
    id: 'esri-2016',
    group: 'photo',
    label: 'Satellite Esri 2016',
    hint: 'Maxar, 31 cm',
    date: '2016-06-22',
    create: () => esriWayback(48376),
  },
  {
    id: 'esri-2015',
    group: 'photo',
    label: 'Satellite Esri 2015',
    hint: 'DigitalGlobe, 50 cm',
    date: '2015-08-20',
    create: () => esriWayback(13045),
  },
  {
    id: 'ign-2014',
    group: 'photo',
    label: 'IGN BD ORTHO 2014',
    hint: 'Photo aérienne, 50 cm',
    date: '2014-09-02',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2014', 'PM_0_18'),
  },
  {
    id: 'esri-2013',
    group: 'photo',
    label: 'Satellite Esri 2013',
    hint: 'DigitalGlobe, jeunes plantations visibles',
    date: '2013-10-24',
    create: () => esriWayback(6678),
  },
  {
    id: 'ign-2011',
    group: 'photo',
    label: 'IGN BD ORTHO 2011',
    hint: 'Photo aérienne, 50 cm',
    date: '2011',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2011', 'PM_6_18'),
  },
  {
    id: 'ign-2007',
    group: 'photo',
    label: 'IGN BD ORTHO 2007',
    hint: 'Photo aérienne, 50 cm',
    date: '2007-09-13',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2007', 'PM_6_18'),
  },
  {
    id: 'ign-2002',
    group: 'photo',
    label: 'IGN BD ORTHO 2002',
    hint: 'Photo aérienne, 50 cm',
    date: '2002-06-26',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS2002', 'PM_6_18'),
  },
  {
    id: 'ign-1969',
    group: 'photo',
    label: 'IGN historique 1969',
    hint: 'Photo noir et blanc',
    date: '1969-06-12',
    create: () =>
      ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.1965-1980', 'PM_3_18', { format: 'image/png', style: 'BDORTHOHISTORIQUE' }),
  },
  {
    id: 'ign-1958',
    group: 'photo',
    label: 'IGN historique 1958',
    hint: 'Photo noir et blanc',
    date: '1958-06-14',
    create: () =>
      ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', 'PM_0_18', { format: 'image/png', style: 'BDORTHOHISTORIQUE' }),
  },

  // --- Technique ---------------------------------------------------------------
  {
    id: 'ign-irc-2026',
    group: 'technique',
    label: 'Infrarouge 2026',
    hint: 'Végétation en rouge, Ortho-Express',
    date: '2026',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.IRC-EXPRESS.2026', 'PM_0_19'),
  },
  {
    id: 'ign-lidar-mnh',
    group: 'technique',
    label: 'Hauteur des arbres (LiDAR HD)',
    hint: 'Hors feuilles, sur photo 2023',
    date: '2024-03-20',
    // Le MNH ombré seul est peu lisible : semi-transparent sur la photo aérienne.
    create: () =>
      L.layerGroup([
        bdOrthoFallback(),
        ignWmts('IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'PM_0_18', {
          format: 'image/png',
          opacity: 0.7,
        }),
      ]),
  },
  {
    id: 'ign-irc',
    group: 'technique',
    label: 'Infrarouge 2023',
    hint: 'Végétation en rouge, BD ORTHO',
    date: '2023-05-29',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.IRC.2023', 'PM_6_19'),
  },
  {
    id: 'ign-irc-2020',
    group: 'technique',
    label: 'Infrarouge 2020',
    hint: 'Végétation en rouge, BD ORTHO',
    date: '2020-07-18',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.IRC.2020', 'PM_6_19'),
  },
  {
    id: 'ign-irc-2017',
    group: 'technique',
    label: 'Infrarouge 2017',
    hint: 'Végétation en rouge, automne',
    date: '2017-10-14',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.IRC.2017', 'PM_6_18'),
  },
  {
    id: 'ign-irc-2014',
    group: 'technique',
    label: 'Infrarouge 2014',
    hint: 'Végétation en rouge, BD ORTHO',
    date: '2014-09-02',
    create: () => ignWmts('ORTHOIMAGERY.ORTHOPHOTOS.IRC.2014', 'PM_6_18'),
  },
];

/** Plus récent d'abord ; les sources sans date publiée en tête de leur groupe. */
function byDateDesc(a: BaseLayerOption, b: BaseLayerOption): number {
  if (a.date === b.date) return 0;
  if (a.date === null) return -1;
  if (b.date === null) return 1;
  return a.date < b.date ? 1 : -1;
}

export const BASE_LAYER_GROUPS: { group: BaseLayerGroup; label: string; options: BaseLayerOption[] }[] = [
  { group: 'photo', label: 'Photos', options: OPTIONS.filter((o) => o.group === 'photo').sort(byDateDesc) },
  { group: 'technique', label: 'Technique', options: OPTIONS.filter((o) => o.group === 'technique').sort(byDateDesc) },
];

export const BASE_LAYER_OPTIONS: BaseLayerOption[] = BASE_LAYER_GROUPS.flatMap((g) => g.options);

export const DEFAULT_BASE_LAYER = 'ign-pcrs';

/** "2023-05-29" → "29/05/2023", "2026" → "2026", estimée → "≈ 2023 (estimée)", null → "date non publiée". */
export function formatLayerDate(option: Pick<BaseLayerOption, 'date' | 'dateEstimated'>): string {
  if (!option.date) {
    return 'date non publiée';
  }
  const formatted = option.date.split('-').reverse().join('/');
  return option.dateEstimated ? `≈ ${formatted} (estimée)` : formatted;
}

export function findBaseLayer(id: string): BaseLayerOption {
  return BASE_LAYER_OPTIONS.find((o) => o.id === id) ?? BASE_LAYER_OPTIONS.find((o) => o.id === DEFAULT_BASE_LAYER)!;
}

const STORAGE_KEY = 'quercus.baseLayer';

/** Dernier fond choisi sur cet appareil (simple confort, l'app marche sans). */
export function loadStoredBaseLayer(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && BASE_LAYER_OPTIONS.some((option) => option.id === stored)) {
      return stored;
    }
  } catch {
    // Stockage indisponible (navigation privée, etc.) : fond par défaut.
  }
  return DEFAULT_BASE_LAYER;
}

export function storeBaseLayer(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Sans conséquence : le choix ne sera simplement pas retenu.
  }
}
