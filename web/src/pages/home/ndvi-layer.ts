import * as L from 'leaflet';

// NDVI calculé dans le navigateur à partir des tuiles ORTHO IRC de l'IGN.
//
// Les orthophotos IRC sont une composition colorée décalée d'une bande :
//   canal rouge = proche infrarouge (PIR), canal vert = rouge, canal bleu = vert.
// D'où, pixel par pixel : NDVI = (PIR − Rouge) / (PIR + Rouge) = (R − V) / (R + V).
//
// C'est un pseudo-NDVI : les tuiles sont des comptes numériques 8 bits (JPEG),
// égalisés colorimétriquement par l'IGN, pas des réflectances calibrées. Il compare
// bien les couronnes entre elles sur un même millésime, pas d'une année à l'autre.
//
// Nécessite que la Géoplateforme serve les tuiles avec CORS (crossOrigin) : sans quoi
// le canvas est « souillé » et getImageData lève une erreur (tuile laissée vide).

/** Bornes de la rampe de couleurs : tout ce qui sort est saturé aux extrémités. */
export const NDVI_MIN = -0.2;
export const NDVI_MAX = 0.6;

/** PIR + Rouge en dessous duquel le pixel (ombre portée, eau) est trop bruité. */
const DARK_THRESHOLD = 20;

/** Rampe brun → jaune → vert (type RdYlGn), arrêts répartis sur [NDVI_MIN, NDVI_MAX]. */
const RAMP: [number, number, number][] = [
  [140, 81, 10], // sol nu, routes
  [216, 179, 101],
  [246, 232, 195],
  [199, 234, 175], // herbe sèche, végétation clairsemée
  [120, 198, 121],
  [35, 139, 69],
  [0, 68, 27], // couronnes vigoureuses
];

/** Couleur RGB pour chaque NDVI quantifié sur 256 niveaux entre NDVI_MIN et NDVI_MAX. */
const LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (RAMP.length - 1);
    const k = Math.min(Math.floor(t), RAMP.length - 2);
    const f = t - k;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = RAMP[k][c] + (RAMP[k + 1][c] - RAMP[k][c]) * f;
    }
  }
  return lut;
})();

/** Remplace en place les pixels IRC par leur NDVI en fausses couleurs. */
export function irc2ndvi(data: Uint8ClampedArray): void {
  const scale = 255 / (NDVI_MAX - NDVI_MIN);
  for (let p = 0; p < data.length; p += 4) {
    const pir = data[p];
    const rouge = data[p + 1];
    const sum = pir + rouge;
    if (sum < DARK_THRESHOLD) {
      data[p] = data[p + 1] = data[p + 2] = 40; // gris neutre : pas d'information fiable
      continue;
    }
    const ndvi = (pir - rouge) / sum;
    const i = Math.max(0, Math.min(255, Math.round((ndvi - NDVI_MIN) * scale))) * 3;
    data[p] = LUT[i];
    data[p + 1] = LUT[i + 1];
    data[p + 2] = LUT[i + 2];
  }
}

/** Couche de tuiles qui charge l'IRC et dessine son NDVI sur un canvas. */
export class NdviTileLayer extends L.TileLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const size = this.getTileSize();
    const canvas = document.createElement('canvas');
    canvas.width = size.x;
    canvas.height = size.y;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0, size.x, size.y);
        const pixels = ctx.getImageData(0, 0, size.x, size.y);
        irc2ndvi(pixels.data);
        ctx.putImageData(pixels, 0, 0);
        done(undefined, canvas);
      } catch (error) {
        done(error as Error, canvas);
      }
    };
    image.onerror = () => done(new Error(`Tuile IRC indisponible : ${image.src}`), canvas);
    image.src = this.getTileUrl(coords);
    return canvas;
  }
}
