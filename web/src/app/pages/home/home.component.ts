import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import * as L from 'leaflet';
import { Tree } from '../../models/tree.model';
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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private readonly mapContainer!: ElementRef<HTMLElement>;

  private readonly search = inject(TreeSearchService);

  // La barre de recherche vit dans la toolbar (voir app.component) ; la carte se contente
  // de lire l'état partagé pour filtrer ses pins et afficher le chargement/les erreurs.
  readonly loading = computed(() => this.search.loading());
  readonly error = computed(() => this.search.error());

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private readonly markersByTreeId = new Map<string, L.Marker>();

  constructor() {
    effect(() => this.plotTrees(this.search.trees()));
    effect(() => this.applyFilter(this.search.filteredTrees()));
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

  private plotTrees(trees: Tree[]): void {
    if (!this.markersLayer) {
      return;
    }
    this.markersLayer.clearLayers();
    this.markersByTreeId.clear();

    for (const tree of trees) {
      const marker = L.marker([tree.latitude, tree.longitude], {
        icon: continentPinIcon(tree.continent),
      }).bindPopup(this.popupContent(tree));
      this.markersByTreeId.set(tree.id, marker);
    }
  }

  /** Affiche uniquement les pins correspondant au filtre courant et recadre la carte dessus. */
  private applyFilter(filtered: Tree[]): void {
    if (!this.map || !this.markersLayer) {
      return;
    }

    const visibleIds = new Set(filtered.map((tree) => tree.id));
    this.markersByTreeId.forEach((marker, id) => {
      const shouldShow = visibleIds.has(id);
      const isShown = this.markersLayer!.hasLayer(marker);
      if (shouldShow && !isShown) {
        this.markersLayer!.addLayer(marker);
      } else if (!shouldShow && isShown) {
        this.markersLayer!.removeLayer(marker);
      }
    });

    if (filtered.length === 0) {
      return;
    }
    const bounds = L.featureGroup(
      filtered.map((tree) => this.markersByTreeId.get(tree.id)!).filter(Boolean)
    ).getBounds();
    this.map.flyToBounds(bounds, { padding: [32, 32], maxZoom: 18 });
  }

  private popupContent(tree: Tree): string {
    const speciesLabel = tree.nom_usage || tree.nom_scientifique || tree.name;
    const title = tree.nom_scientifique || tree.reference || speciesLabel || 'Arbre';
    const subtitle = tree.reference && speciesLabel ? speciesLabel : null;
    const date = new Date(tree.created_at).toLocaleDateString('fr-FR');
    const wikipediaLink = tree.wikipedia_url
      ? `<br><a href="${tree.wikipedia_url}" target="_blank" rel="noopener">Voir sur Wikipédia</a>`
      : '';
    const continent = tree.continent ? `<br>Continent : ${this.escapeHtml(tree.continent)}` : '';
    return `
      <strong>${this.escapeHtml(title)}</strong>
      ${subtitle ? `<br>${this.escapeHtml(subtitle)}` : ''}
      ${tree.reference ? `(${tree.reference})` : ''}
      ${wikipediaLink}
      ${continent}
      <br>Précision : ±${Math.round(tree.accuracy)} m
      <br>Saisi le ${date}
    `;
  }

  private escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }
}
