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
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import * as L from 'leaflet';
import { Tree } from '../../models/tree.model';
import { resolveUicnStatus, UicnStatus } from '../../models/uicn-status';
import { TreeSearchService } from '../../services/tree-search.service';

// Les icônes par défaut de Leaflet référencent des images relatives à son propre CSS,
// ce qui casse une fois bundlé par Angular. On les repointe vers les assets copiés
// depuis node_modules/leaflet/dist/images (voir angular.json).
const DEFAULT_ICON = L.icon({
  iconUrl: 'leaflet/marker-icon.png',
  iconRetinaUrl: 'leaflet/marker-icon-2x.png',
  shadowUrl: 'leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DEFAULT_ICON;

const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const DEFAULT_CENTER: L.LatLngTuple = [46.6, 1.88]; // Centre approximatif de la France
const DEFAULT_ZOOM = 5;

// Couleurs moyennement saturées par continent d'origine, utilisées pour teinter
// les pins de la carte. "Quercus sp." et les continents inconnus retombent sur le gris.
const CONTINENT_COLORS: Record<string, string> = {
  Europe: '#4C7EA8',
  'Amérique du Nord': '#5B9B5B',
  Mexique: '#B5544A',
  Asie: '#C9A227',
};
const DEFAULT_PIN_COLOR = '#9AA0A6';

const PIN_ICON_CACHE = new Map<string, L.DivIcon>();

function pinIcon(color: string): L.DivIcon {
  const cached = PIN_ICON_CACHE.get(color);
  if (cached) {
    return cached;
  }
  const icon = L.divIcon({
    className: 'continent-pin',
    html: `
      <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5s12.5-19.1 12.5-28.5C25 5.6 19.4 0 12.5 0z"
              fill="${color}" stroke="#ffffff" stroke-width="1.5" />
        <circle cx="12.5" cy="12.5" r="5" fill="#ffffff" opacity="0.85" />
      </svg>
    `,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
  PIN_ICON_CACHE.set(color, icon);
  return icon;
}

function continentPinIcon(continent: string | null | undefined): L.DivIcon {
  return pinIcon((continent && CONTINENT_COLORS[continent]) || DEFAULT_PIN_COLOR);
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
  imports: [DatePipe, DecimalPipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private readonly mapContainer!: ElementRef<HTMLElement>;

  private readonly search = inject(TreeSearchService);

  // La barre de recherche vit dans la toolbar (voir app.component) ; la carte se contente
  // de lire l'état partagé pour mettre en avant les pins correspondants et afficher le
  // chargement/les erreurs.
  readonly loading = computed(() => this.search.loading());
  readonly error = computed(() => this.search.error());

  // Fiche mise en avant (recherche en cours, ou clic sur un pin qui alimente la
  // recherche) : affichée en pleine opacité sur la carte et dans le panneau latéral.
  readonly selectedTree = computed(() => this.search.selectedTree());

  /** Références distinctes des arbres chargés, triées comme le catalogue — sert de
   * piste de navigation Précédent/Suivant dans le panneau de détail. */
  readonly sortedReferences = computed(() => {
    const refs = new Set<string>();
    for (const tree of this.search.trees()) {
      if (tree.reference) {
        refs.add(tree.reference);
      }
    }
    return Array.from(refs).sort(compareReferences);
  });

  readonly canNavigate = computed(() => this.sortedReferences().length > 1);

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private readonly markersByTreeId = new Map<string, L.Marker>();
  private readonly treesById = new Map<string, Tree>();

  constructor() {
    effect(() => this.plotTrees(this.search.trees()));
    effect(() => this.applyHighlight(this.selectedTree()));
  }

  ngOnInit(): void {
    this.map = L.map(this.mapContainer.nativeElement).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer(SATELLITE_TILE_URL, {
      attribution: SATELLITE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(this.map);
    this.markersLayer = L.layerGroup().addTo(this.map);

    this.search.reload();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  /** Trace tous les pins (toujours affichés) et recadre la carte dessus. */
  private plotTrees(trees: Tree[]): void {
    if (!this.map || !this.markersLayer) {
      return;
    }
    this.markersLayer.clearLayers();
    this.markersByTreeId.clear();
    this.treesById.clear();

    for (const tree of trees) {
      const marker = L.marker([tree.latitude, tree.longitude], {
        icon: continentPinIcon(tree.continent),
      }).on('click', () => this.search.selectTree(tree));
      marker.addTo(this.markersLayer);
      this.markersByTreeId.set(tree.id, marker);
      this.treesById.set(tree.id, tree);
    }
    // Lu hors suivi de dépendances : sinon la recherche (via selectedTree) deviendrait
    // une dépendance de CET effet, et rejouerait tout plotTrees (donc fitBounds) à
    // chaque changement de recherche au lieu du seul effet d'estompage.
    untracked(() => this.applyHighlight(this.selectedTree()));

    if (trees.length === 0) {
      return;
    }
    const bounds = L.featureGroup(Array.from(this.markersByTreeId.values())).getBounds();
    this.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 18 });
  }

  /** Estompe les pins des espèces différentes de celle mise en avant par la recherche. */
  private applyHighlight(selected: Tree | null): void {
    this.markersByTreeId.forEach((marker, id) => {
      const tree = this.treesById.get(id);
      const isSelected = !selected || tree?.reference === selected.reference;
      marker.getElement()?.classList.toggle('continent-pin--lowlight', !isSelected);
    });
  }

  closePanel(): void {
    this.search.clearSearch();
  }

  /** Passe à la fiche précédente/suivante du catalogue, en bouclant aux extrémités. */
  navigate(step: 1 | -1): void {
    const current = this.selectedTree();
    if (!current?.reference) {
      return;
    }
    const refs = this.sortedReferences();
    const index = refs.indexOf(current.reference);
    if (index === -1) {
      return;
    }
    const nextReference = refs[(index + step + refs.length) % refs.length];
    const nextTree = this.search.trees().find((tree) => tree.reference === nextReference);
    if (nextTree) {
      this.search.selectTree(nextTree);
    }
  }

  uicnStatus(code: string | null | undefined): UicnStatus | null {
    return resolveUicnStatus(code);
  }

  /** Titre du panneau de détail : le nom scientifique prime, avec repli sur les autres champs saisis. */
  treeTitle(tree: Tree): string {
    return tree.nom_scientifique || tree.reference || tree.nom_usage || tree.name || 'Arbre';
  }

  /** Nom d'usage affiché en sous-titre, sauf s'il fait doublon avec le titre. */
  treeSubtitle(tree: Tree): string | null {
    return tree.nom_usage && tree.nom_usage !== this.treeTitle(tree) ? tree.nom_usage : null;
  }
}
