import { useMemo } from 'react';
import { create } from 'zustand';
import { api } from '../api';
import { type Crown, type CrownFeature, isIdentified } from '../models/crown';

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

export function crownLabel(crown: Crown): string {
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
 * de la toolbar (`App.tsx`), la carte (`HomePage.tsx`) et la liste (`ListingPage.tsx`).
 * Centraliser ici évite de dupliquer le chargement.
 *
 * Seules les couronnes identifiées (portant au moins un relevé) participent à la
 * recherche ; les couronnes LiDAR sans relevé restent sélectionnables sur la carte.
 */
interface CrownState {
  loading: boolean;
  error: string | null;
  features: CrownFeature[];
  /** Texte du champ de recherche, tel que saisi. */
  searchText: string;
  /** Requête effective, légèrement débouncée pour lisser la saisie rapide. */
  searchQuery: string;
  /** Sélection explicite (clic sur une couronne, navigation Précédent/Suivant, ligne de
   * la liste) : prime sur la recherche texte tant qu'elle n'a pas été invalidée par une
   * nouvelle saisie. Nécessaire car `selectCrown` ne peut pas se contenter de réinjecter
   * le libellé dans la recherche : deux fiches peuvent partager un sous-texte (ex. les
   * références "1" et "31" via la recherche par sous-chaîne), ce qui ferait retomber
   * `filteredCrowns[0]` sur la mauvaise fiche. */
  selectedCrownId: string | null;
}

export const useCrowns = create<CrownState>()(() => ({
  loading: false,
  error: null,
  features: [],
  searchText: '',
  searchQuery: '',
  selectedCrownId: null,
}));

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Saisie réelle dans la recherche : invalide la sélection explicite pour rendre la main à la recherche. */
export function setSearchText(text: string): void {
  useCrowns.setState({ searchText: text, selectedCrownId: null });
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => useCrowns.setState({ searchQuery: text }), SEARCH_DEBOUNCE_MS);
}

export function clearSearch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  useCrowns.setState({ searchText: '', searchQuery: '', selectedCrownId: null });
}

/** Fixe la sélection sur la couronne donnée, et reflète son libellé dans le champ de
 * recherche sans relancer la recherche floue (voir `selectedCrownId`). */
export function selectCrown(crown: Crown): void {
  useCrowns.setState({ selectedCrownId: crown.id, searchText: crownLabel(crown) });
}

let reloadSeq = 0;

/** Recharge les couronnes depuis l'API (ex. à chaque visite de la carte, pour rester à jour). */
export async function reloadCrowns(): Promise<void> {
  const seq = ++reloadSeq;
  useCrowns.setState({ loading: true, error: null });
  try {
    const collection = await api.listCrowns();
    if (seq === reloadSeq) {
      useCrowns.setState({ loading: false, features: collection.features });
    }
  } catch {
    if (seq === reloadSeq) {
      useCrowns.setState({ loading: false, error: 'Impossible de charger les arbres enregistrés.' });
    }
  }
}

/**
 * Masque (ou restaure) une couronne LiDAR. Mise à jour locale pour une couronne sans
 * relevé, afin de ne pas retélécharger toutes les couronnes à chaque suppression ;
 * rechargement complet sinon, ses relevés devenant (ou cessant d'être) des cercles GPS.
 */
export async function setCrownHidden(crown: Crown, hidden: boolean): Promise<void> {
  if (crown.crown_id === null) {
    throw new Error('Seules les couronnes LiDAR peuvent être masquées.');
  }
  await (hidden ? api.hideCrown(crown.crown_id) : api.restoreCrown(crown.crown_id));
  if (crown.readings.length) {
    void reloadCrowns();
    return;
  }
  useCrowns.setState((state) => ({
    features: state.features.map((feature) =>
      feature.properties.id === crown.id ? { ...feature, properties: { ...feature.properties, hidden } } : feature,
    ),
  }));
}

// --- Valeurs dérivées --------------------------------------------------------
// Calculées dans des hooks mémoïsés plutôt que dans le store : zustand compare les
// sélecteurs par référence, un tableau recalculé à chaque lecture bouclerait.

function computeIdentified(features: CrownFeature[]): Crown[] {
  return features.map((feature) => feature.properties).filter(isIdentified);
}

export function useIdentifiedCrowns(): Crown[] {
  const features = useCrowns((s) => s.features);
  return useMemo(() => computeIdentified(features), [features]);
}

/** Couronne mise en avant sur la carte (pleine opacité + panneau latéral). */
export function useSelectedCrown(): Crown | null {
  const features = useCrowns((s) => s.features);
  const selectedId = useCrowns((s) => s.selectedCrownId);
  const query = useCrowns((s) => s.searchQuery);
  return useMemo(() => {
    if (selectedId) {
      return features.find((feature) => feature.properties.id === selectedId)?.properties ?? null;
    }
    const normalized = normalize(query);
    if (!normalized) {
      return null;
    }
    return computeIdentified(features).find((crown) => matchesQuery(crown, normalized)) ?? null;
  }, [features, selectedId, query]);
}

/** Suggestions d'autocomplétion : fiches distinctes (par référence) des couronnes identifiées, filtrées sur la saisie. */
export function useSearchOptions(): CrownSearchOption[] {
  const identified = useIdentifiedCrowns();
  const query = useCrowns((s) => s.searchQuery);
  const sorted = useMemo(() => {
    const byKey = new Map<string, CrownSearchOption>();
    for (const crown of identified) {
      const option = toSearchOption(crown);
      if (option.value && !byKey.has(option.key)) {
        byKey.set(option.key, option);
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      (a.scientificName || a.commonName).localeCompare(b.scientificName || b.commonName, 'fr'),
    );
  }, [identified]);
  return useMemo(() => {
    const normalized = normalize(query);
    const filtered = normalized
      ? sorted.filter((option) =>
          normalize(`${option.scientificName} ${option.commonName} ${option.reference}`).includes(normalized),
        )
      : sorted;
    return filtered.slice(0, MAX_SEARCH_OPTIONS);
  }, [sorted, query]);
}
