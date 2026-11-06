import type { CrownCollection } from './models/crown';
import type { Species } from './models/species';
import type { CreateTreePayload, Tree } from './models/tree';

/** Wrappers HTTP minces vers le backend FastAPI (proxifié sous /api/ par nginx ou Vite). */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} : HTTP ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface MeResponse {
  authenticated: boolean;
  name?: string | null;
  email?: string | null;
}

export const api = {
  me: () => request<MeResponse>('/api/auth/me'),

  /** Couronnes LiDAR fusionnées avec les relevés GPS (backend app/crowns.py). */
  listCrowns: () => request<CrownCollection>('/api/crowns'),
  /** Suppression "douce" : la couronne est marquée `hidden` dans le GeoJSON, pas effacée. */
  hideCrown: (crownId: number) => request<void>(`/api/crowns/${crownId}`, { method: 'DELETE' }),
  restoreCrown: (crownId: number) => request<void>(`/api/crowns/${crownId}/restore`, { method: 'POST' }),

  createTree: (payload: CreateTreePayload) =>
    request<Tree>('/api/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};

let speciesCache: Promise<Species[]> | null = null;

/** Liste complète du catalogue quercitum, mise en cache pour l'autocomplétion. */
export function listSpecies(): Promise<Species[]> {
  if (!speciesCache) {
    speciesCache = request<Species[]>('/api/species').catch((error) => {
      speciesCache = null; // Nouvel essai à la prochaine demande plutôt qu'un échec mis en cache.
      throw error;
    });
  }
  return speciesCache;
}
