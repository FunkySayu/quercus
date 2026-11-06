import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Spinner, Toaster } from './components/ui';
import { login, useAuth } from './stores/auth';
import { startGeolocation, stopGeolocation } from './stores/geolocation';

// Pages chargées à la demande, comme le lazy-loading des routes Angular d'origine.
const HomePage = lazy(() => import('./pages/home/HomePage'));
const EntryPage = lazy(() => import('./pages/EntryPage'));
const ListingPage = lazy(() => import('./pages/ListingPage'));

export function App() {
  const refreshAuth = useAuth((s) => s.refresh);

  useEffect(() => {
    // Démarre le ping GPS dès l'ouverture de l'app pour que la précision ait le
    // temps de se stabiliser avant que l'utilisateur n'atteigne le formulaire de saisie.
    startGeolocation();
    void refreshAuth();
    return stopGeolocation;
  }, [refreshAuth]);

  return (
    <BrowserRouter>
      <div className="flex h-full flex-col">
        <main className="min-h-0 flex-auto overflow-auto">
          <Suspense
            fallback={
              <div className="flex justify-center p-8">
                <Spinner size={32} />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route
                path="/saisie"
                element={
                  <RequireAuth>
                    <EntryPage />
                  </RequireAuth>
                }
              />
              <Route path="/liste" element={<ListingPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <Toaster />
      </div>
    </BrowserRouter>
  );
}

/** Bloque /saisie et envoie directement vers le login Authentik si non connecté. */
function RequireAuth({ children }: { children: ReactNode }) {
  const authenticated = useAuth((s) => s.authenticated);
  const refresh = useAuth((s) => s.refresh);
  const location = useLocation();

  useEffect(() => {
    if (authenticated === null) {
      void refresh();
    } else if (!authenticated) {
      login(location.pathname + location.search);
    }
  }, [authenticated, refresh, location.pathname, location.search]);

  if (!authenticated) {
    return (
      <div className="flex justify-center p-8">
        <Spinner size={32} />
      </div>
    );
  }
  return children;
}
