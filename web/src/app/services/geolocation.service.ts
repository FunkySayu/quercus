import { Injectable, computed, signal } from '@angular/core';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface GoodFix {
  coordinates: Coordinates;
  capturedAt: number;
}

const PING_INTERVAL_MS = 1000;
const GOOD_ACCURACY_M = 10;
const GOOD_FIX_TTL_MS = 10000;

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** Cadence de la boucle de ping, exposée pour que l'UI puisse animer le compte à rebours. */
  readonly pingIntervalMs = PING_INTERVAL_MS;

  private running = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastGoodFix: GoodFix | null = null;

  /** Dernière position reçue, quelle que soit sa précision (pour le feedback visuel). */
  readonly currentReading = signal<Coordinates | null>(null);
  readonly currentError = signal<string | null>(null);

  /** Horodatage du prochain ping attendu, pour animer la barre de progression. */
  readonly nextPingAt = signal<number | null>(null);

  /** Dernière position <10m de précision, réutilisable pendant ~10s le temps de saisir le formulaire. */
  readonly recordableCoordinates = signal<Coordinates | null>(null);
  readonly canRecord = computed(() => this.recordableCoordinates() !== null);

  /** Démarre la boucle de ping GPS. Sans effet si déjà démarrée. Pensé pour tourner tant que l'app est ouverte. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private tick(): void {
    if (!('geolocation' in navigator)) {
      this.currentError.set("La géolocalisation n'est pas supportée par ce navigateur.");
      return;
    }

    this.nextPingAt.set(Date.now() + PING_INTERVAL_MS);

    this.request({ enableHighAccuracy: true, timeout: 5000, maximumAge: 2000 })
      .then((position) => {
        const coordinates: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        this.currentReading.set(coordinates);
        this.currentError.set(null);

        if (coordinates.accuracy <= GOOD_ACCURACY_M) {
          this.lastGoodFix = { coordinates, capturedAt: Date.now() };
        }
      })
      .catch((error: GeolocationPositionError) => {
        this.currentReading.set(null);
        this.currentError.set(this.toError(error).message);
      })
      .finally(() => {
        this.refreshRecordableCoordinates();
        if (this.running) {
          this.timeoutId = setTimeout(() => this.tick(), PING_INTERVAL_MS);
        }
      });
  }

  private refreshRecordableCoordinates(): void {
    const fix = this.lastGoodFix;
    const isFresh = fix !== null && Date.now() - fix.capturedAt <= GOOD_FIX_TTL_MS;
    this.recordableCoordinates.set(isFresh ? fix!.coordinates : null);
  }

  private request(options: PositionOptions): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  private toError(error: GeolocationPositionError): Error {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return new Error(
          "L'accès à la position a été refusé. Autorisez la géolocalisation pour ce site."
        );
      case error.POSITION_UNAVAILABLE:
        return new Error(
          "La position actuelle est indisponible (vérifiez que le Wi-Fi est activé et le service de localisation autorisé). Réessayez."
        );
      case error.TIMEOUT:
        return new Error("Le délai d'obtention de la position a expiré.");
      default:
        return new Error('Erreur inconnue lors de la géolocalisation.');
    }
  }
}
