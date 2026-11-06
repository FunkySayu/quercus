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
inconnu/non identifié) sert notamment à colorer les pins de la carte
(voir `home.component.ts`).

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

- **`web/`** — Angular 17 (standalone components, signals), Angular
  Material, Leaflet pour la carte. Buildé en statique et servi par nginx
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

### Frontend (`web/src/app/`)

Routes (`app.routes.ts`), toutes en lazy-loading standalone :
- `/` (`pages/home`) — carte Leaflet (fond satellite Esri) avec un pin
  par arbre relevé, popup enrichi (référence, nom, lien Wikipédia).
- `/saisie` (`pages/entry`) — formulaire de terrain : ping GPS continu
  (`services/geolocation.service.ts`, démarré au bootstrap de l'app dans
  `app.component.ts`) tant que la précision n'est pas suffisante
  (< 10 m), puis deux champs (référence / nom) avec autocomplétion
  Material sur le catalogue d'espèces (`services/species.service.ts`) —
  sélectionner une suggestion synchronise les deux champs vers la même
  fiche.
- `/liste` (`pages/listing`) — tableau de tous les relevés.

`services/tree.service.ts` et `services/species.service.ts` sont de
simples wrappers HTTP vers `/api/trees` et `/api/species`.

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
