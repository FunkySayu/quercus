import * as L from 'leaflet';

// Calque EXPÉRIMENTAL : couronnes d'arbres détectées sur le MNH LiDAR HD, et
// rattachement de chaque relevé GPS à une couronne. Les GeoJSON sont produits hors
// de l'app par backend/tools/lidar_crowns.py et servis par le backend
// (app/routers/lidar.py) : tant qu'ils n'ont pas été générés (404), le calque
// n'est simplement pas proposé.

const CROWNS_URL = '/api/lidar/crowns';
const READINGS_URL = '/api/lidar/readings';

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

/**
 * Intervalle de plantation estimé d'après les photos aériennes datées (voir
 * backend/tools/crown_history.py) : null si non estimé (ancien fichier ou arbre
 * jamais détecté durablement).
 */
function plantingLabel(after: number | null | undefined, by: number | null | undefined): string | null {
  if (!by) {
    return null;
  }
  return after ? `Plantation estimée : entre ${after} et ${by}` : `Plantation estimée : avant ${by}`;
}

/** Charge le calque, ou null si les fichiers d'expérimentation ne sont pas là. */
export async function loadLidarOverlay(): Promise<L.Layer | null> {
  const [crowns, readings] = await Promise.all([fetchGeoJson(CROWNS_URL), fetchGeoJson(READINGS_URL)]);
  if (!crowns) {
    return null;
  }

  const crownsLayer = L.geoJSON(crowns, {
    style: (feature) => {
      const matched = (feature?.properties?.n_readings ?? 0) > 0;
      return {
        color: matched ? '#FFB300' : '#FFFFFF',
        weight: matched ? 2 : 1,
        opacity: matched ? 1 : 0.7,
        fillColor: '#FFB300',
        fillOpacity: matched ? 0.25 : 0,
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties ?? {};
      const refs = (p.references ?? []).join(', ') || 'aucun relevé';
      const planting = plantingLabel(p.planted_after, p.planted_by);
      layer.bindTooltip(
        `Couronne #${p.crown_id}<br>Hauteur ${p.height_m} m · Ø ${p.diameter_m} m` +
          (planting ? `<br>${planting}` : '') +
          `<br>Relevé : ${refs}`,
        { sticky: true },
      );
    },
  });

  // Trait relevé GPS → sommet de la couronne retenue, pointillé rouge si non rattaché.
  const links = L.layerGroup();
  for (const feature of readings?.features ?? []) {
    const p = feature.properties ?? {};
    const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
    if (p['snapped_to']) {
      const [tLng, tLat] = p['snapped_to'];
      L.polyline(
        [
          [lat, lng],
          [tLat, tLng],
        ],
        { color: '#FFB300', weight: 2, interactive: false },
      ).addTo(links);
      L.circleMarker([tLat, tLng], { radius: 3, color: '#FFB300', fillOpacity: 1, interactive: false }).addTo(links);
    } else {
      L.circleMarker([lat, lng], { radius: 9, color: '#E53935', weight: 2, dashArray: '3 3', fill: false })
        .bindTooltip(`Réf. ${p['reference']} : aucune couronne LiDAR à moins de ${p['dist_to_top_m']} m`)
        .addTo(links);
    }
  }

  return L.layerGroup([crownsLayer, links]);
}
