# chenes-localisation

## Concept

Application de terrain pour géolocaliser et cataloguer les chênes du
**quercitum de la Mothe** (une collection d'arbres). Quand quelqu'un se
rend sur place avec son téléphone, l'app relève sa position GPS et
l'associe à une fiche du catalogue d'espèces — soit une fiche existante
(sélectionnée par autocomplétion), soit une nouvelle fiche créée à la
volée avec un numéro de référence inédit. Le catalogue d'espèces
(`quercitum.md` → `species_seed.csv`) fournit ensuite les données
enrichies (nom scientifique, nom d'usage, origine, statut UICN, lien
Wikipédia, description, continent) affichées sur la carte et dans la
liste, sans avoir à ressaisir cette information à chaque arbre planté.
Le continent (`Europe`, `Amérique du Nord`, `Mexique`, `Asie`, vide si
inconnu/non identifié) sert notamment à colorer les couronnes de la carte
(voir `web/src/pages/home/crown-style.ts`).

L'unité affichée par l'UI est la **couronne**, pas le relevé : chaque arbre
est un polygone, sa couronne LiDAR quand un relevé y est rattaché, sinon un
cercle de 2 m autour du relevé GPS (voir `app/crowns.py`).

Deux jeux de données, deux logiques de vie différentes :
- **Le catalogue d'espèces** (`species.csv`) : référentiel relativement
  stable, une ligne par espèce/fiche du quercitum, identifiée par son
  numéro de référence (ex. `24`, `24 Bis`, `50 Ter` — repris tel quel du
  document source).
- **Les relevés d'arbres** (`trees.csv`) : un enregistrement par pointage
  GPS sur le terrain, qui référence une entrée du catalogue.

## Architecture

Deux services derrière Docker Compose (`docker-compose.yml`), qui tire les
images `ghcr.io/funkysayu/quercus-{backend,web}` publiées par
`.github/workflows/docker-publish.yml` (push sur `main` / tags `v*`) :

- **`web/`** — React 19 + TypeScript (Vite), Tailwind CSS, zustand pour
  l'état partagé, react-router, Leaflet pour la carte. Buildé en statique et servi par nginx
  (`web/Dockerfile`, `web/nginx.conf`), qui reverse-proxy `/api/` vers le
  backend.
- **`backend/`** — FastAPI (Python), stockage en fichiers CSV plats (pas
  de base de données). Servi par uvicorn.

Les deux fichiers CSV vivent dans `data/` à la racine du repo (monté en volume Docker
sur `/data`, voir `docker-compose.yml`) — c'est un **volume persistant
avec des données réelles de terrain**, pas des fixtures. Le dossier est
gitignore, sauf le seed initial du catalogue qui est versionné à part
(voir plus bas). Ne jamais reset/écraser ce volume sans y réfléchir à
deux fois.

### Backend (`backend/app/`)

- `main.py` — app FastAPI, monte les routers `trees` et `species`.
- `auth.py` / `routers/auth.py` — connexion OIDC Authentik (cookie `session`
  = id_token). **Mode dev** : `AUTH_DEV_MODE=1` court-circuite Authentik
  (variables `AUTHENTIK_*` alors facultatives) — `/api/auth/login` pose juste
  un cookie factice `dev-session` reconnu comme utilisateur « Mode dev »,
  `/logout` l'efface. Jamais en production (non défini dans
  `docker-compose.yml`) ; hors mode dev ce cookie est rejeté comme tout jeton
  invalide.
- `models.py` — modèles Pydantic : `Species`, `TreeCreate`/`Tree`. `Tree`
  hérite de `TreeCreate` et ajoute les champs d'enrichissement
  (`nom_scientifique`, `nom_usage`, `origine`, `statut_uicn`,
  `wikipedia_url`, `description`, `continent`), remplis à la lecture par
  jointure avec le catalogue.
- `storage.py` — toute la logique de lecture/écriture CSV, protégée par
  des `threading.Lock` (pas de vrai moteur de transaction, donc attention
  en cas de montée en charge concurrente — c'est volontairement simple
  pour un usage à quelques utilisateurs sur le terrain).
  - `list_trees()` / `append_tree()` : CRUD sur `trees.csv`, avec
    jointure sur `species.csv` par référence à la lecture.
  - `list_species()` : lit `species.csv` (initialisé depuis le seed
    `app/data/species_seed.csv` au premier démarrage si le fichier
    runtime n'existe pas encore).
  - `get_or_create_species(reference, name)` — cœur de la logique
    catalogue : réutilise une entrée existante si la référence ou le nom
    (scientifique ou d'usage) correspond déjà à une fiche ; sinon crée une
    nouvelle fiche (avec le numéro donné s'il est explicite, ou le
    prochain numéro libre si seul un nom a été fourni).
  - `app/data/species_seed.csv` — seed versionné dans git, généré une
    fois depuis `quercitum.md` (conversion manuelle, pas de script
    conservé dans le repo). C'est la donnée de référence livrée avec
    l'app ; `species.csv` (runtime, dans le volume) en est une copie
    éditable qui accumule les nouvelles fiches créées sur le terrain.
- `routers/trees.py` — `GET/POST /api/trees`. Le `POST` résout toujours
  la fiche espèce via `get_or_create_species` avant d'écrire la ligne (la
  référence enregistrée est donc toujours celle de la fiche résolue, pas
  forcément le texte brut saisi).
- `routers/species.py` — `GET /api/species`, sert le catalogue complet
  (utilisé côté front pour l'autocomplétion — la volumétrie est faible,
  pas de recherche serveur).
- `crowns.py` + `routers/crowns.py` — `GET /api/crowns`, **source de données
  de l'UI** : FeatureCollection fusionnant `lidar_crowns.geojson`,
  `lidar_readings.geojson` et, en direct, `trees.csv` / `species.csv`. Un
  relevé rattaché (`match` `inside` ou `snapped`, cf. `IDENTIFIED_MATCHES`)
  est fusionné dans sa couronne (une fiche par couronne) ; un relevé
  `unmatched` ou postérieur au dernier calcul LiDAR devient un cercle de 2 m
  (`source: "gps"`). Les couronnes sans relevé sont aussi servies
  (`readings: []`). Sans fichiers LiDAR, tous les relevés sont des cercles.
  Couronnes masquées : `DELETE /api/crowns/{crown_id}` (connecté) ne supprime
  rien, il pose `hidden: true` (+ `hidden_by` / `hidden_at`) dans
  `lidar_crowns.geojson` ; `POST /api/crowns/{crown_id}/restore` le retire.
  `GET /api/crowns` les filtre pour les visiteurs et les renvoie marquées aux
  utilisateurs connectés (affichées grisées, restaurables). Les relevés d'une
  couronne masquée retombent en cercles GPS. `tools/lidar_crowns.py` reporte
  les marqueurs à la régénération (par position du sommet, les numéros de
  couronne n'étant pas stables).
- `routers/lidar.py` — `GET /api/lidar/crowns` et `/api/lidar/readings` :
  sert tels quels `lidar_crowns.geojson` / `lidar_readings.geojson`, à côté
  de `trees.csv` (ou dans `LIDAR_DIR`), 404 tant qu'ils n'ont pas été générés. Ils sont produits
  hors-ligne par `backend/tools/lidar_crowns.py` (dépendances à part dans
  `tools/requirements.txt`, hors image Docker) : couronnes d'arbres détectées
  sur le MNH LiDAR HD IGN + rattachement un-pour-un des relevés aux
  couronnes. Le script ne fait que lire les CSV ; les rattachements sont
  figés au moment du lancement, à relancer après une session de terrain.
  Il ajoute aussi à chaque couronne un intervalle de plantation estimé
  (`planted_after` / `planted_by`, `tools/crown_history.py`) d'après les
  photos aériennes datées 1958-2023 (cache dans `data/aerial_cache/`,
  `--no-history` pour sauter) : fiable à l'échelle d'un îlot, ±1 millésime
  à l'arbre près, null pour ~27 % des couronnes jamais détectées durablement.

### Frontend (`web/src/`)

`npm start` lance Vite (proxy `/api` → `localhost:8000`, voir
`vite.config.ts`) ; `npm run build` type-check puis builde dans `dist/`.

Routes (`App.tsx`, avec la toolbar et la garde `RequireAuth` de `/saisie`),
pages chargées en lazy-loading :
- `/` (`pages/home/HomePage.tsx`) — carte Leaflet pilotée impérativement
  (pas de react-leaflet) : un polygone par couronne (`/api/crowns`), coloré
  par continent si identifié, contour discret sinon (`crown-style.ts`) ;
  clic → panneau de détail `TreePanel.tsx` (fiche espèce + hauteur,
  plantation estimée, relevés). Fonds de carte dans `base-layers.ts` /
  `BaseLayerPicker.tsx` ; calque optionnel de diagnostic `lidar-overlay.ts`
  (relevés GPS bruts → sommet de couronne).
- `/saisie` (`pages/EntryPage.tsx`) — formulaire de terrain : ping GPS
  continu (`stores/geolocation.ts`, démarré au montage de `App`) tant que la
  précision n'est pas suffisante (< 10 m), puis deux champs (référence /
  nom) avec autocomplétion sur le catalogue d'espèces (`listSpecies()` dans
  `api.ts`) — sélectionner une suggestion synchronise les deux champs vers
  la même fiche.
- `/liste` (`pages/ListingPage.tsx`) — tableau des arbres identifiés (une
  ligne par couronne / cercle GPS) ; clic → ouvre l'arbre sur la carte.

État partagé en stores zustand (`stores/`) : `crowns.ts` porte les couronnes
chargées, la recherche de la toolbar et la sélection (valeurs dérivées dans
des hooks mémoïsés, `useSelectedCrown` etc. — jamais de tableau recalculé
dans un sélecteur zustand, ça bouclerait) ; `auth.ts`, `geolocation.ts`,
`toast.ts`. `api.ts` regroupe les wrappers `fetch` vers le backend.

UI en Tailwind v4 (thème dans `index.css`, breakpoint `sm` à 600 px), sans
bibliothèque de composants : autocomplétion, toasts, spinner, boutons dans
`components/ui.tsx` ; icônes via la police Material Icons (`<Icon name>`).

## Points d'attention pour un futur changement

- `trees.csv` et `species.csv` sont des données réelles de terrain, pas
  des fixtures de test — toute modification manuelle doit être
  chirurgicale et justifiée (ex. rattacher une ligne orpheline à la bonne
  référence), jamais une réécriture en masse.
- Les références au format `"N Bis"` / `"N Ter"` (espace inclus) sont la
  convention adoptée pour coller à la numérotation du document source
  (`quercitum.md`) ; le tri (`storage._species_sort_key`) en dépend.
- Si `quercitum.md` est mis à jour, `app/data/species_seed.csv` doit être
  régénéré à la main (il n'y a pas de script de conversion versionné) —
  et ça ne doit pas écraser les fiches créées entre-temps dans le
  `species.csv` runtime des déploiements existants.
