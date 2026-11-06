import { create } from 'zustand';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface GoodFix {
  coordinates: Coordinates;
  capturedAt: number;
}

/** Cadence de la boucle de ping, exposée pour que l'UI puisse animer le compte à rebours. */
export const PING_INTERVAL_MS = 1000;
const GOOD_ACCURACY_M = 10;
const GOOD_FIX_TTL_MS = 10000;

interface GeolocationState {
  /** Dernière position reçue, quelle que soit sa précision (pour le feedback visuel). */
  currentReading: Coordinates | null;
  currentError: string | null;
  /** Horodatage du prochain ping attendu, pour animer la barre de progression. */
  nextPingAt: number | null;
  /** Dernière position <10m de précision, réutilisable pendant ~10s le temps de saisir le formulaire. */
  recordableCoordinates: Coordinates | null;
}

export const useGeolocation = create<GeolocationState>()(() => ({
  currentReading: null,
  currentError: null,
  nextPingAt: null,
  recordableCoordinates: null,
}));

let running = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let lastGoodFix: GoodFix | null = null;

/** Démarre la boucle de ping GPS. Sans effet si déjà démarrée. Pensé pour tourner tant que l'app est ouverte. */
export function startGeolocation(): void {
  if (running) {
    return;
  }
  running = true;
  tick();
}

export function stopGeolocation(): void {
  running = false;
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function tick(): void {
  if (!('geolocation' in navigator)) {
    useGeolocation.setState({ currentError: "La géolocalisation n'est pas supportée par ce navigateur." });
    return;
  }

  useGeolocation.setState({ nextPingAt: Date.now() + PING_INTERVAL_MS });

  new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 2000,
    }),
  )
    .then((position) => {
      const coordinates: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      useGeolocation.setState({ currentReading: coordinates, currentError: null });
      if (coordinates.accuracy <= GOOD_ACCURACY_M) {
        lastGoodFix = { coordinates, capturedAt: Date.now() };
      }
    })
    .catch((error: GeolocationPositionError) => {
      useGeolocation.setState({ currentReading: null, currentError: errorMessage(error) });
    })
    .finally(() => {
      const fix = lastGoodFix;
      const isFresh = fix !== null && Date.now() - fix.capturedAt <= GOOD_FIX_TTL_MS;
      useGeolocation.setState({ recordableCoordinates: isFresh ? fix.coordinates : null });
      if (running) {
        timeoutId = setTimeout(tick, PING_INTERVAL_MS);
      }
    });
}

function errorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "L'accès à la position a été refusé. Autorisez la géolocalisation pour ce site.";
    case error.POSITION_UNAVAILABLE:
      return 'La position actuelle est indisponible (vérifiez que le Wi-Fi est activé et le service de localisation autorisé). Réessayez.';
    case error.TIMEOUT:
      return "Le délai d'obtention de la position a expiré.";
    default:
      return 'Erreur inconnue lors de la géolocalisation.';
  }
}
