import { Injectable, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { Observable, debounceTime, distinctUntilChanged, map, tap } from 'rxjs';
import { Crown, CrownFeature, isIdentified } from '../models/crown.model';
import { CrownService } from './crown.service';

const MAX_SEARCH_OPTIONS = 20;
const SEARCH_DEBOUNCE_MS = 150;

/** Casse et accents ignorés, pour une recherche plus tolérante ("chene" trouve "chêne"). */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function crownLabel(crown: Crown): string {
  return crown.nom_usage || crown.nom_scientifique || crown.name || crown.reference || '';
}

function matchesQuery(crown: Crown, normalizedQuery: string): boolean {
  const haystack = [crown.nom_usage, crown.nom_scientifique, crown.name, crown.reference, crown.continent]
    .filter((value): value is string => !!value)
    .map(normalize)
    .join(' ');
  return haystack.includes(normalizedQuery);
}

/** Une suggestion d'autocomplétion : une fiche du catalogue (nom scientifique, nom
 * commun, numéro de référence), déduite des couronnes identifiées. */
export interface CrownSearchOption {
  key: string;
  value: string;
  scientificName: string;
  commonName: string;
  reference: string;
}

function toSearchOption(crown: Crown): CrownSearchOption {
  return {
    key: crown.reference || crown.name || crown.id,
    value: crownLabel(crown),
    scientificName: crown.nom_scientifique || '',
    commonName: crown.nom_usage || '',
    reference: crown.reference || '',
  };
}

/**
 * État partagé des couronnes et de leur recherche, utilisé par la barre de recherche
 * de la toolbar (`app.component`), la carte (`home.component`) et la liste
 * (`listing.component`). Centraliser ici évite de dupliquer le chargement.
 *
 * Seules les couronnes identifiées (portant au moins un relevé) participent à la
 * recherche ; les couronnes LiDAR sans relevé restent sélectionnables sur la carte.
 */
@Injectable({ providedIn: 'root' })
export class CrownSearchService {
  readonly searchControl = new FormControl('', { nonNullable: true });

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly features = signal<CrownFeature[]>([]);

  readonly crowns = computed(() => this.features().map((feature) => feature.properties));
  readonly identifiedCrowns = computed(() => this.crowns().filter(isIdentified));

  /** Requête normalisée, légèrement débouncée pour lisser la saisie rapide. */
  private readonly searchQuery = toSignal(
    this.searchControl.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
    { initialValue: '' }
  );

  readonly filteredCrowns = computed(() => {
    const query = normalize(this.searchQuery());
    if (!query) {
      return this.identifiedCrowns();
    }
    return this.identifiedCrowns().filter((crown) => matchesQuery(crown, query));
  });

  readonly matchCount = computed(() => this.filteredCrowns().length);

  /** Sélection explicite (clic sur une couronne, navigation Précédent/Suivant, ligne de
   * la liste) : prime sur la recherche texte tant qu'elle n'a pas été invalidée par une
   * nouvelle saisie (voir constructor). Nécessaire car `selectCrown` ne peut pas se
   * contenter de réinjecter le libellé dans la recherche : deux fiches peuvent partager
   * un sous-texte (ex. les références "1" et "31" via la recherche par sous-chaîne), ce
   * qui ferait retomber `filteredCrowns()[0]` sur la mauvaise fiche. */
  private readonly selectedCrownId = signal<string | null>(null);

  /** Couronne mise en avant sur la carte (pleine opacité + panneau latéral). */
  readonly selectedCrown = computed<Crown | null>(() => {
    const id = this.selectedCrownId();
    if (id) {
      return this.crowns().find((crown) => crown.id === id) ?? null;
    }
    if (!normalize(this.searchQuery())) {
      return null;
    }
    return this.filteredCrowns()[0] ?? null;
  });

  /** Suggestions d'autocomplétion : fiches distinctes (par référence) des couronnes identifiées, filtrées sur la saisie. */
  readonly searchOptions = computed(() => {
    const byKey = new Map<string, CrownSearchOption>();
    for (const crown of this.identifiedCrowns()) {
      const option = toSearchOption(crown);
      if (option.value && !byKey.has(option.key)) {
        byKey.set(option.key, option);
      }
    }
    const sorted = Array.from(byKey.values()).sort((a, b) =>
      (a.scientificName || a.commonName).localeCompare(b.scientificName || b.commonName, 'fr')
    );
    const query = normalize(this.searchQuery());
    const filtered = query
      ? sorted.filter((option) =>
          normalize(`${option.scientificName} ${option.commonName} ${option.reference}`).includes(query)
        )
      : sorted;
    return filtered.slice(0, MAX_SEARCH_OPTIONS);
  });

  constructor(private readonly crownService: CrownService) {
    this.reload();
    // Toute saisie réelle dans la recherche invalide la sélection explicite, pour lui
    // rendre la main sur `selectedCrown`. `selectCrown()` met à jour le champ avec
    // `emitEvent: false` : ce flux ne s'y déclenche donc que sur une vraie saisie.
    this.searchControl.valueChanges.subscribe(() => this.selectedCrownId.set(null));
  }

  clearSearch(): void {
    this.selectedCrownId.set(null);
    this.searchControl.setValue('');
  }

  /** Fixe la sélection sur la couronne donnée, et reflète son libellé dans le champ de
   * recherche sans relancer la recherche floue (voir `selectedCrownId`). */
  selectCrown(crown: Crown): void {
    this.selectedCrownId.set(crown.id);
    this.searchControl.setValue(crownLabel(crown), { emitEvent: false });
  }

  /**
   * Masque (ou restaure) une couronne LiDAR. Mise à jour locale pour une couronne sans
   * relevé, afin de ne pas retélécharger toutes les couronnes à chaque suppression ;
   * rechargement complet sinon, ses relevés devenant (ou cessant d'être) des cercles GPS.
   */
  setHidden(crown: Crown, hidden: boolean): Observable<void> {
    if (crown.crown_id === null) {
      throw new Error('Seules les couronnes LiDAR peuvent être masquées.');
    }
    const request = hidden ? this.crownService.hide(crown.crown_id) : this.crownService.restore(crown.crown_id);
    return request.pipe(
      tap(() => {
        if (crown.readings.length) {
          this.reload();
          return;
        }
        this.features.update((features) =>
          features.map((feature) =>
            feature.properties.id === crown.id
              ? { ...feature, properties: { ...feature.properties, hidden } }
              : feature,
          ),
        );
      }),
      map(() => undefined),
    );
  }

  /** Recharge les couronnes depuis l'API (ex. à chaque visite de la carte, pour rester à jour). */
  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.crownService.list().subscribe({
      next: (collection) => {
        this.loading.set(false);
        this.features.set(collection.features);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Impossible de charger les arbres enregistrés.');
      },
    });
  }
}
