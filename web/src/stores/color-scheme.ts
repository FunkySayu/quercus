import { create } from 'zustand';

/** Mode de coloration des couronnes de la carte (voir `pages/home/crown-style.ts`). */
export type ColorScheme = 'continent' | 'species' | 'planting';

export const COLOR_SCHEMES: { id: ColorScheme; label: string; hint: string }[] = [
  { id: 'continent', label: 'Continent', hint: "Origine de l'espèce" },
  { id: 'species', label: 'Espèce', hint: 'Une couleur par fiche du catalogue' },
  { id: 'planting', label: 'Plantation', hint: 'Date estimée, photos aériennes' },
];

const STORAGE_KEY = 'quercus.colorScheme';

function loadStored(): ColorScheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (COLOR_SCHEMES.some((scheme) => scheme.id === stored)) {
      return stored as ColorScheme;
    }
  } catch {
    // Stockage indisponible (navigation privée…) : mode par défaut.
  }
  return 'continent';
}

export const useColorScheme = create<{ scheme: ColorScheme }>()(() => ({ scheme: loadStored() }));

export function setColorScheme(scheme: ColorScheme): void {
  useColorScheme.setState({ scheme });
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // Choix non mémorisé : sans conséquence.
  }
}
