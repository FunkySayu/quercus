import { create } from 'zustand';
import { api } from '../api';

interface AuthState {
  /** `null` tant que le premier appel à /api/auth/me n'a pas répondu. */
  authenticated: boolean | null;
  userName: string | null;
  refresh: () => Promise<boolean>;
}

let pending: Promise<boolean> | null = null;

export const useAuth = create<AuthState>()((set) => ({
  authenticated: null,
  userName: null,
  refresh: () => {
    // Appels simultanés (bootstrap de l'app + garde de /saisie) : une seule requête.
    pending ??= api
      .me()
      .then((response) => {
        set({ authenticated: response.authenticated, userName: response.name ?? response.email ?? null });
        return response.authenticated;
      })
      .catch(() => {
        set({ authenticated: false, userName: null });
        return false;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  },
}));

/** Redirection plein-page vers le login Authentik (flow OAuth2 côté backend). */
export function login(next: string = '/'): void {
  window.location.href = `/api/auth/login?next=${encodeURIComponent(next)}`;
}

export function logout(): void {
  window.location.href = '/api/auth/logout';
}
