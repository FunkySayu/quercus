import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { Autocomplete, Icon, Spinner, Toaster } from './components/ui';
import { login, logout, useAuth } from './stores/auth';
import { clearSearch, setSearchText, useCrowns, useSearchOptions } from './stores/crowns';
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
        <Toolbar />
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

const NAV_LINK =
  'inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:bg-white/10 max-sm:size-10 max-sm:justify-center max-sm:rounded-full max-sm:px-0';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `${NAV_LINK} ${isActive ? 'bg-white/15' : ''}`;
}

/** Libellé masqué sur mobile : on garde les icônes pour laisser la place à la recherche. */
function NavLabel({ children }: { children: ReactNode }) {
  return <span className="max-sm:hidden">{children}</span>;
}

function Toolbar() {
  const authenticated = useAuth((s) => s.authenticated);

  return (
    <header className="flex h-16 shrink-0 items-center gap-1 bg-primary px-4 text-white shadow-md max-sm:h-14 max-sm:px-2">
      <Link to="/" className="flex items-center gap-2 text-white">
        <Icon name="park" />
        <span className="text-xl font-medium whitespace-nowrap max-sm:hidden">Localisation des chênes</span>
      </Link>

      <ToolbarSearch />

      {authenticated && (
        <NavLink to="/saisie" className={navLinkClass} aria-label="Saisie">
          <Icon name="add_location_alt" />
          <NavLabel>Saisie</NavLabel>
        </NavLink>
      )}
      <NavLink to="/liste" className={navLinkClass} aria-label="Liste">
        <Icon name="list" />
        <NavLabel>Liste</NavLabel>
      </NavLink>

      {authenticated === true && (
        <button type="button" className={`${NAV_LINK} cursor-pointer`} aria-label="Déconnexion" onClick={logout}>
          <Icon name="logout" />
          <NavLabel>Déconnexion</NavLabel>
        </button>
      )}
      {authenticated === false && (
        <button type="button" className={`${NAV_LINK} cursor-pointer`} aria-label="Connexion" onClick={() => login()}>
          <Icon name="login" />
          <NavLabel>Connexion</NavLabel>
        </button>
      )}
    </header>
  );
}

/** Barre de recherche centrée dans l'espace restant de la toolbar (état partagé : stores/crowns.ts). */
function ToolbarSearch() {
  const searchText = useCrowns((s) => s.searchText);
  const options = useSearchOptions();

  return (
    <div className="flex min-w-0 flex-auto justify-center px-4 max-sm:px-2">
      <Autocomplete
        id="toolbar-search"
        className="w-full max-w-[420px]"
        value={searchText}
        onChange={setSearchText}
        options={options.map((option) => ({
          key: option.key,
          value: option.value,
          primary: option.scientificName,
          secondary: `${option.commonName} (${option.reference})`,
        }))}
        placeholder="Rechercher un arbre…"
        inputClassName="h-10 w-full rounded-md border border-white/40 bg-white/12 pr-10 pl-10 text-white caret-white placeholder:text-white/70 focus:border-white focus:outline-none"
        prefix={<Icon name="search" className="pointer-events-none absolute left-2.5 text-white/90" />}
        suffix={
          searchText && (
            <button
              type="button"
              aria-label="Effacer"
              className="absolute right-1 flex size-8 cursor-pointer items-center justify-center rounded-full text-white/90 hover:bg-white/10"
              onClick={clearSearch}
            >
              <Icon name="close" />
            </button>
          )
        }
      />
    </div>
  );
}
