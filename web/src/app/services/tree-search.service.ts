import { Injectable, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { Tree } from '../models/tree.model';
import { TreeService } from './tree.service';

const MAX_SEARCH_OPTIONS = 20;
const SEARCH_DEBOUNCE_MS = 150;

/** Casse et accents ignorés, pour une recherche plus tolérante ("chene" trouve "chêne"). */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function treeLabel(tree: Tree): string {
  return tree.nom_usage || tree.nom_scientifique || tree.name || tree.reference || '';
}

function matchesQuery(tree: Tree, normalizedQuery: string): boolean {
  const haystack = [tree.nom_usage, tree.nom_scientifique, tree.name, tree.reference, tree.continent]
    .filter((value): value is string => !!value)
    .map(normalize)
    .join(' ');
  return haystack.includes(normalizedQuery);
}

/** Une suggestion d'autocomplétion : une fiche du catalogue (nom scientifique, nom
 * commun, numéro de référence), déduite des arbres réellement plantés. */
export interface TreeSearchOption {
  key: string;
  value: string;
  scientificName: string;
  commonName: string;
  reference: string;
}

function toSearchOption(tree: Tree): TreeSearchOption {
  return {
    key: tree.reference || tree.name || tree.id,
    value: treeLabel(tree),
    scientificName: tree.nom_scientifique || '',
    commonName: tree.nom_usage || '',
    reference: tree.reference || '',
  };
}

/**
 * État partagé de la recherche d'arbres, utilisé à la fois par la barre de recherche
 * de la toolbar (`app.component`) et par la carte (`home.component`) qui l'exploite
 * pour filtrer ses pins. Centraliser ici évite de dupliquer le chargement des arbres.
 */
@Injectable({ providedIn: 'root' })
export class TreeSearchService {
  readonly searchControl = new FormControl('', { nonNullable: true });

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly trees = signal<Tree[]>([]);

  /** Requête normalisée, légèrement débouncée pour lisser la saisie rapide. */
  private readonly searchQuery = toSignal(
    this.searchControl.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
    { initialValue: '' }
  );

  readonly filteredTrees = computed(() => {
    const query = normalize(this.searchQuery());
    if (!query) {
      return this.trees();
    }
    return this.trees().filter((tree) => matchesQuery(tree, query));
  });

  readonly matchCount = computed(() => this.filteredTrees().length);

  /** Suggestions d'autocomplétion : fiches distinctes (par référence) des arbres chargés, filtrées sur la saisie. */
  readonly searchOptions = computed(() => {
    const byKey = new Map<string, TreeSearchOption>();
    for (const tree of this.trees()) {
      const option = toSearchOption(tree);
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

  constructor(private readonly treeService: TreeService) {
    this.reload();
  }

  clearSearch(): void {
    this.searchControl.setValue('');
  }

  /** Recharge la liste des arbres depuis l'API (ex. à chaque visite de la carte, pour rester à jour). */
  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.treeService.list().subscribe({
      next: (trees) => {
        this.loading.set(false);
        this.trees.set(trees);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Impossible de charger les arbres enregistrés.');
      },
    });
  }
}
