import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import * as L from 'leaflet';
import { Crown, CrownFeature, canHide, isIdentified, plantingLabel } from '../../models/crown.model';
import { resolveUicnStatus, UicnStatus } from '../../models/uicn-status';
import { AuthService } from '../../services/auth.service';
import { CrownSearchService } from '../../services/crown-search.service';
import { Coordinates, GeolocationService } from '../../services/geolocation.service';
import {
  BASE_LAYER_GROUPS,
  MAP_MAX_ZOOM,
  findBaseLayer,
  formatLayerDate,
  loadStoredBaseLayer,
  storeBaseLayer,
} from './base-layers';
import { DIAGNOSTIC_PANE, loadLidarOverlay } from './lidar-overlay';

const DEFAULT_CENTER: L.LatLngTuple = [46.6, 1.88]; // Centre approximatif de la France
const DEFAULT_ZOOM = 5;

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

function continentColor(continent: string | null | undefined): string {
  return (continent && CONTINENT_COLORS[continent]) || DEFAULT_CROWN_COLOR;
}

/** `selected` : la couronne cliquée/recherchée ; `lowlight` : estompée car d'une autre fiche. */
type CrownState = 'normal' | 'selected' | 'lowlight';

function crownStyle(crown: Crown, state: CrownState): L.PathOptions {
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

function compareReferences(a: string, b: string): number {
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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private readonly mapContainer!: ElementRef<HTMLElement>;

  private readonly search = inject(CrownSearchService);
  private readonly geolocation = inject(GeolocationService);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);

  /** Masquer/restaurer une couronne : réservé aux utilisateurs connectés (le backend
   * ne leur renvoie qu'à eux les couronnes masquées). */
  readonly canEdit = computed(() => this.auth.authenticated() === true);
  readonly hiding = signal(false);

  // La barre de recherche vit dans la toolbar (voir app.component) ; la carte se contente
  // de lire l'état partagé pour mettre en avant les couronnes correspondantes et afficher
  // le chargement/les erreurs.
  readonly loading = computed(() => this.search.loading());
  readonly error = computed(() => this.search.error());

  // Couronne mise en avant (recherche en cours, ou clic sur la carte qui alimente la
  // recherche) : affichée en surbrillance sur la carte et dans le panneau latéral.
  readonly selectedCrown = computed(() => this.search.selectedCrown());

  /** Références distinctes des couronnes identifiées, triées comme le catalogue — sert
   * de piste de navigation Précédent/Suivant dans le panneau de détail. */
  readonly sortedReferences = computed(() => {
    const refs = new Set<string>();
    for (const crown of this.search.identifiedCrowns()) {
      if (crown.reference) {
        refs.add(crown.reference);
      }
    }
    return Array.from(refs).sort(compareReferences);
  });

  readonly canNavigate = computed(() => {
    const selected = this.selectedCrown();
    return !!selected?.reference && this.sortedReferences().length > 1;
  });

  /** Sur mobile, le panneau de détail s'ouvre d'abord replié (titre/sous-titre
   * seuls) : ce signal contrôle le "voir plus" qui déplie le reste des infos.
   * Sans effet sur desktop, où tout est toujours affiché (voir home.component.scss). */
  readonly mobilePanelExpanded = signal(false);

  /** Fond de carte choisi dans le sélecteur en haut à droite (voir base-layers.ts). */
  readonly baseLayerGroups = BASE_LAYER_GROUPS;
  readonly formatLayerDate = formatLayerDate;
  readonly baseLayerId = signal<string>(loadStoredBaseLayer());
  readonly baseLayerOption = computed(() => findBaseLayer(this.baseLayerId()));

  /** Calque de diagnostic relevés GPS → couronnes : proposé seulement si le fichier existe. */
  readonly lidarOverlayAvailable = signal(false);
  readonly lidarOverlayVisible = signal(false);
  private lidarOverlay: L.Layer | null = null;

  readonly isIdentified = isIdentified;
  readonly canHide = canHide;
  readonly plantingLabel = plantingLabel;

  private map: L.Map | null = null;
  private baseLayer: L.Layer | null = null;
  private crownsLayer: L.GeoJSON | null = null;
  private readonly pathsByCrownId = new Map<string, L.Path>();
  private readonly crownsById = new Map<string, Crown>();
  private userLocationMarker: L.CircleMarker | null = null;
  /** Recadrage fait une seule fois par visite de la carte : les redessins suivants
   * (rechargement, couronne masquée) ne doivent pas faire sauter la vue. */
  private framed = false;

  constructor() {
    effect(() => this.plotCrowns(this.search.features()));
    effect(() => this.applyHighlight(this.selectedCrown()));
    effect(() => this.revealCrown(this.selectedCrown()));
    // Effet séparé de plotCrowns : la position de l'utilisateur ne doit jamais
    // participer au recadrage (fitBounds) de la carte sur les arbres.
    effect(() => this.plotUserLocation(this.geolocation.currentReading()));
    effect(() => this.applyBaseLayer(this.baseLayerId()));
    // Toute nouvelle sélection (ou fermeture) repart du panneau replié sur mobile.
    effect(
      () => {
        this.selectedCrown();
        this.mobilePanelExpanded.set(false);
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    this.map = L.map(this.mapContainer.nativeElement, { maxZoom: MAP_MAX_ZOOM }).setView(
      DEFAULT_CENTER,
      DEFAULT_ZOOM,
    );
    // Posé ici plutôt que d'attendre l'effet : il a pu tourner avant la création de la carte.
    untracked(() => this.applyBaseLayer(this.baseLayerId()));
    // Au-dessus des couronnes (overlayPane, z-index 400), qui sont redessinées à chaque rechargement.
    this.map.createPane(DIAGNOSTIC_PANE).style.zIndex = '450';
    loadLidarOverlay().then((layer) => {
      this.lidarOverlay = layer;
      this.lidarOverlayAvailable.set(layer !== null);
    });

    this.search.reload();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  toggleLidarOverlay(): void {
    if (!this.map || !this.lidarOverlay) {
      return;
    }
    const visible = !this.lidarOverlayVisible();
    this.lidarOverlayVisible.set(visible);
    if (visible) {
      this.lidarOverlay.addTo(this.map);
    } else {
      this.lidarOverlay.remove();
    }
  }

  selectBaseLayer(id: string): void {
    this.baseLayerId.set(id);
    storeBaseLayer(id);
  }

  /** Remplace le fond de carte courant, sous les couronnes (ajoutées dans leur propre calque). */
  private applyBaseLayer(id: string): void {
    if (!this.map) {
      return;
    }
    this.baseLayer?.remove();
    this.baseLayer = findBaseLayer(id).create().addTo(this.map);
  }

  /** Trace toutes les couronnes et recadre la carte sur celles qui sont identifiées. */
  private plotCrowns(features: CrownFeature[]): void {
    if (!this.map) {
      return;
    }
    this.crownsLayer?.remove();
    this.pathsByCrownId.clear();
    this.crownsById.clear();

    // Couronnes non identifiées d'abord : les fiches sont dessinées par-dessus et
    // restent cliquables là où un cercle GPS recouvre une couronne.
    const ordered = [...features].sort(
      (a, b) => Number(isIdentified(a.properties)) - Number(isIdentified(b.properties)),
    );
    const identifiedPaths: L.Path[] = [];
    this.crownsLayer = L.geoJSON(ordered, {
      style: (feature) => crownStyle(feature!.properties as Crown, 'normal'),
      onEachFeature: (feature, layer) => {
        const crown = feature.properties as Crown;
        const path = layer as L.Path;
        path.on('click', () => this.search.selectCrown(crown));
        this.pathsByCrownId.set(crown.id, path);
        this.crownsById.set(crown.id, crown);
        if (isIdentified(crown)) {
          identifiedPaths.push(path);
        }
      },
    }).addTo(this.map);
    // Lu hors suivi de dépendances : sinon la recherche (via selectedCrown) deviendrait
    // une dépendance de CET effet, et rejouerait tout plotCrowns (donc fitBounds) à
    // chaque changement de recherche au lieu du seul effet de surbrillance.
    untracked(() => this.applyHighlight(this.selectedCrown()));

    // Arrivée avec une sélection déjà faite (ex. clic dans la liste) : on cadre dessus
    // plutôt que sur l'ensemble des fiches.
    const selected = untracked(() => this.selectedCrown());
    const selectedPath = selected ? this.pathsByCrownId.get(selected.id) : undefined;
    const framed = selectedPath ?? (identifiedPaths.length ? L.featureGroup(identifiedPaths) : this.crownsLayer);
    const bounds = (framed as L.Polygon | L.FeatureGroup).getBounds();
    if (!this.framed && bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 19 });
      this.framed = true;
    }
  }

  /** Recentre la carte sur la couronne sélectionnée si elle est hors champ (recherche,
   * Précédent/Suivant), sans toucher au zoom choisi par l'utilisateur. */
  private revealCrown(crown: Crown | null): void {
    const path = crown ? this.pathsByCrownId.get(crown.id) : undefined;
    if (!this.map || !path) {
      return;
    }
    const center = (path as L.Polygon).getBounds().getCenter();
    if (!this.map.getBounds().contains(center)) {
      this.map.panTo(center);
    }
  }

  /** Affiche la position GPS courante de l'utilisateur, sans jamais recadrer la
   * carte dessus (contrairement à plotCrowns) : elle bouge en continu et ne doit
   * pas faire sauter la vue pendant la consultation de la carte. */
  private plotUserLocation(coordinates: Coordinates | null): void {
    if (!this.map) {
      return;
    }
    if (!coordinates) {
      this.userLocationMarker?.remove();
      this.userLocationMarker = null;
      return;
    }
    const latLng: L.LatLngTuple = [coordinates.latitude, coordinates.longitude];
    if (this.userLocationMarker) {
      this.userLocationMarker.setLatLng(latLng);
    } else {
      this.userLocationMarker = L.circleMarker(latLng, {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#1A73E8',
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip('Votre position')
        .addTo(this.map);
    }
  }

  /** Met en avant la couronne sélectionnée et celles de la même fiche, estompe les autres. */
  private applyHighlight(selected: Crown | null): void {
    this.pathsByCrownId.forEach((path, id) => {
      const crown = this.crownsById.get(id);
      if (!crown) {
        return;
      }
      let state: CrownState = 'normal';
      if (selected) {
        if (crown.id === selected.id) {
          state = 'selected';
        } else if (!(isIdentified(selected) && isIdentified(crown) && crown.reference === selected.reference)) {
          state = 'lowlight';
        }
      }
      path.setStyle(crownStyle(crown, state));
      // Seule une fiche passe au premier plan : une couronne non identifiée remontée
      // masquerait ensuite les cercles GPS posés dessus.
      if (state === 'selected' && isIdentified(crown)) {
        path.bringToFront();
      }
    });
  }

  /** Masque ("supprime") ou restaure la couronne sélectionnée, avec annulation possible. */
  toggleHidden(crown: Crown): void {
    if (!canHide(crown) || this.hiding()) {
      return;
    }
    const hide = !crown.hidden;
    if (
      hide &&
      isIdentified(crown) &&
      !window.confirm(
        `Cette couronne porte la fiche ${crown.reference ?? ''}. La masquer détache ses relevés, ` +
          'qui seront affichés comme simples positions GPS. Continuer ?',
      )
    ) {
      return;
    }
    this.hiding.set(true);
    this.search.setHidden(crown, hide).subscribe({
      next: () => {
        this.hiding.set(false);
        const ref = this.snackBar.open(hide ? 'Couronne masquée.' : 'Couronne restaurée.', 'Annuler', {
          duration: 5000,
        });
        ref.onAction().subscribe(() =>
          this.search.setHidden({ ...crown, hidden: hide }, !hide).subscribe({
            error: () => this.snackBar.open("Échec de l'annulation.", 'Fermer', { duration: 5000 }),
          }),
        );
      },
      error: () => {
        this.hiding.set(false);
        this.snackBar.open('Échec de la modification, veuillez réessayer.', 'Fermer', { duration: 5000 });
      },
    });
  }

  closePanel(): void {
    this.search.clearSearch();
  }

  toggleMobilePanel(): void {
    this.mobilePanelExpanded.update((expanded) => !expanded);
  }

  /** Passe à la fiche précédente/suivante du catalogue, en bouclant aux extrémités. */
  navigate(step: 1 | -1): void {
    const current = this.selectedCrown();
    if (!current?.reference) {
      return;
    }
    const refs = this.sortedReferences();
    const index = refs.indexOf(current.reference);
    if (index === -1) {
      return;
    }
    const nextReference = refs[(index + step + refs.length) % refs.length];
    const nextCrown = this.search.identifiedCrowns().find((crown) => crown.reference === nextReference);
    if (nextCrown) {
      this.search.selectCrown(nextCrown);
    }
  }

  uicnStatus(code: string | null | undefined): UicnStatus | null {
    return resolveUicnStatus(code);
  }

  /** Titre du panneau de détail : le nom scientifique prime, avec repli sur les autres champs saisis. */
  crownTitle(crown: Crown): string {
    if (crown.hidden) {
      return 'Couronne masquée';
    }
    if (!isIdentified(crown)) {
      return 'Couronne non identifiée';
    }
    return crown.nom_scientifique || crown.reference || crown.nom_usage || crown.name || 'Arbre';
  }

  /** Nom d'usage affiché en sous-titre, sauf s'il fait doublon avec le titre. */
  crownSubtitle(crown: Crown): string | null {
    if (crown.hidden) {
      return "Non affichée aux visiteurs : elle n'est pas suivie";
    }
    if (!isIdentified(crown)) {
      return 'Arbre détecté par LiDAR, aucun relevé rattaché';
    }
    return crown.nom_usage && crown.nom_usage !== this.crownTitle(crown) ? crown.nom_usage : null;
  }
}
