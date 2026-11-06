import * as L from 'leaflet';

// Calque de DIAGNOSTIC du rattachement relevés GPS → couronnes LiDAR : les couronnes
// elles-mêmes sont déjà le calque principal de la carte (voir home.component.ts) ; on
// affiche ici la position GPS brute de chaque relevé et le trait vers le sommet de la
// couronne retenue par backend/tools/lidar_crowns.py. Tant que le script n'a pas été
// lancé (404 sur /api/lidar/readings), le calque n'est simplement pas proposé.

const READINGS_URL = '/api/lidar/readings';

/** Pane dédié, créé par la carte (home.component.ts) au-dessus des couronnes. */
export const DIAGNOSTIC_PANE = 'diagnostic';

async function fetchGeoJson(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const response = await fetch(url);
    if (!response.ok || !(response.headers.get('content-type') ?? '').match(/json|geo/)) {
      return null;
    }
    return (await response.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

/** Charge le calque, ou null si le fichier de rattachement n'est pas là. */
export async function loadLidarOverlay(): Promise<L.Layer | null> {
  const readings = await fetchGeoJson(READINGS_URL);
  if (!readings) {
    return null;
  }

  // Point GPS brut → sommet de la couronne retenue ; cercle pointillé rouge si non rattaché
  // (il est alors affiché comme un cercle de 2 m sur la carte principale).
  const links = L.layerGroup();
  for (const feature of readings.features) {
    const p = feature.properties ?? {};
    const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
    if (p['snapped_to']) {
      const [tLng, tLat] = p['snapped_to'];
      L.polyline(
        [
          [lat, lng],
          [tLat, tLng],
        ],
        { pane: DIAGNOSTIC_PANE, color: '#FFB300', weight: 2, interactive: false },
      ).addTo(links);
      L.circleMarker([lat, lng], { pane: DIAGNOSTIC_PANE, radius: 3, color: '#FFB300', fillOpacity: 1 })
        .bindTooltip(`Réf. ${p['reference']} : relevé GPS (${p['match'] === 'inside' ? 'dans la couronne' : 'rattaché'}, ${p['dist_to_top_m']} m du sommet)`)
        .addTo(links);
    } else {
      L.circleMarker([lat, lng], { pane: DIAGNOSTIC_PANE, radius: 9, color: '#E53935', weight: 2, dashArray: '3 3', fill: false })
        .bindTooltip(`Réf. ${p['reference']} : aucune couronne LiDAR à moins de ${p['dist_to_top_m']} m`)
        .addTo(links);
    }
  }
  return links;
}
