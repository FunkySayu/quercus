import { Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import * as L from 'leaflet';
import { Tree } from '../../models/tree.model';
import { TreeService } from '../../services/tree.service';

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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private readonly mapContainer!: ElementRef<HTMLElement>;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private map: L.Map | null = null;

  constructor(private readonly treeService: TreeService) {}

  ngOnInit(): void {
    this.map = L.map(this.mapContainer.nativeElement).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer(SATELLITE_TILE_URL, {
      attribution: SATELLITE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(this.map);

    this.loadTrees();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  private loadTrees(): void {
    this.loading.set(true);
    this.error.set(null);
    this.treeService.list().subscribe({
      next: (trees) => {
        this.loading.set(false);
        this.plotTrees(trees);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Impossible de charger les arbres enregistrés.');
      },
    });
  }

  private plotTrees(trees: Tree[]): void {
    if (!this.map || trees.length === 0) {
      return;
    }

    const markers = trees.map((tree) =>
      L.marker([tree.latitude, tree.longitude]).bindPopup(this.popupContent(tree))
    );
    const group = L.featureGroup(markers).addTo(this.map);
    this.map.fitBounds(group.getBounds(), { padding: [32, 32], maxZoom: 18 });
  }

  private popupContent(tree: Tree): string {
    const speciesLabel = tree.nom_usage || tree.nom_scientifique || tree.name;
    const title = tree.reference || speciesLabel || 'Arbre';
    const subtitle = tree.reference && speciesLabel ? speciesLabel : null;
    const date = new Date(tree.created_at).toLocaleDateString('fr-FR');
    const wikipediaLink = tree.wikipedia_url
      ? `<br><a href="${tree.wikipedia_url}" target="_blank" rel="noopener">Voir sur Wikipédia</a>`
      : '';
    return `
      <strong>${this.escapeHtml(title)}</strong>
      ${subtitle ? `<br>${this.escapeHtml(subtitle)}` : ''}
      ${wikipediaLink}
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
