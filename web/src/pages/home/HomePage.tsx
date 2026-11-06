import * as L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Spinner } from '../../components/ui';
import { type Crown, type CrownFeature, canHide, isIdentified } from '../../models/crown';
import { useAuth } from '../../stores/auth';
import {
  clearSearch,
  reloadCrowns,
  selectCrown,
  setCrownHidden,
  useCrowns,
  useIdentifiedCrowns,
  useSelectedCrown,
} from '../../stores/crowns';
import { useGeolocation } from '../../stores/geolocation';
import { showToast } from '../../stores/toast';
import { BaseLayerPicker } from './BaseLayerPicker';
import { MAP_MAX_ZOOM, findBaseLayer, loadStoredBaseLayer, storeBaseLayer } from './base-layers';
import { type CrownState, compareReferences, crownStyle } from './crown-style';
import { DIAGNOSTIC_PANE, loadLidarOverlay } from './lidar-overlay';
import { TreePanel } from './TreePanel';

const DEFAULT_CENTER: L.LatLngTuple = [46.6, 1.88]; // Centre approximatif de la France
const DEFAULT_ZOOM = 5;

/** État Leaflet impératif de la carte, conservé hors du cycle de rendu React. */
interface MapHandles {
  map: L.Map;
  baseLayer: L.Layer | null;
  crownsLayer: L.GeoJSON | null;
  pathsByCrownId: Map<string, L.Path>;
  crownsById: Map<string, Crown>;
  userLocationMarker: L.CircleMarker | null;
  lidarOverlay: L.Layer | null;
  /** Recadrage fait une seule fois par visite de la carte : les redessins suivants
   * (rechargement, couronne masquée) ne doivent pas faire sauter la vue. */
  framed: boolean;
}

/** Met en avant la couronne sélectionnée et celles de la même fiche, estompe les autres. */
function applyHighlight(handles: MapHandles, selected: Crown | null): void {
  handles.pathsByCrownId.forEach((path, id) => {
    const crown = handles.crownsById.get(id);
    if (!crown) {
      return;
    }
    let state: CrownState = 'normal';
    if (selected) {
      if (crown.id === selected.id) {
        state = 'selected';
      } else if (!(isIdentified(selected) && isIdentified(crown) && crown.reference === selected.reference)) {
        state = 'lowlight';
      }
    }
    path.setStyle(crownStyle(crown, state));
    // Seule une fiche passe au premier plan : une couronne non identifiée remontée
    // masquerait ensuite les cercles GPS posés dessus.
    if (state === 'selected' && isIdentified(crown)) {
      path.bringToFront();
    }
  });
}

export default function HomePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<MapHandles | null>(null);

  const features = useCrowns((s) => s.features);
  const loading = useCrowns((s) => s.loading);
  const error = useCrowns((s) => s.error);
  const identifiedCrowns = useIdentifiedCrowns();
  // Couronne mise en avant (recherche de la toolbar, ou clic sur la carte) : affichée
  // en surbrillance sur la carte et dans le panneau latéral.
  const selectedCrown = useSelectedCrown();
  const selectedRef = useRef(selectedCrown);
  selectedRef.current = selectedCrown;
  const currentReading = useGeolocation((s) => s.currentReading);

  /** Masquer/restaurer une couronne : réservé aux utilisateurs connectés (le backend
   * ne leur renvoie qu'à eux les couronnes masquées). */
  const canEdit = useAuth((s) => s.authenticated === true);
  const [hiding, setHiding] = useState(false);

  /** Fond de carte choisi dans le sélecteur en haut à droite (voir base-layers.ts). */
  const [baseLayerId, setBaseLayerId] = useState(loadStoredBaseLayer);
  /** Calque de diagnostic relevés GPS → couronnes : proposé seulement si le fichier existe. */
  const [lidarOverlayAvailable, setLidarOverlayAvailable] = useState(false);
  const [lidarOverlayVisible, setLidarOverlayVisible] = useState(false);

  /** Références distinctes des couronnes identifiées, triées comme le catalogue — sert
   * de piste de navigation Précédent/Suivant dans le panneau de détail. */
  const sortedReferences = useMemo(() => {
    const refs = new Set<string>();
    for (const crown of identifiedCrowns) {
      if (crown.reference) {
        refs.add(crown.reference);
      }
    }
    return Array.from(refs).sort(compareReferences);
  }, [identifiedCrowns]);

  const canNavigate = !!selectedCrown?.reference && sortedReferences.length > 1;

  // --- Effets Leaflet ----------------------------------------------------------
  // Déclarés dans cet ordre exprès : React exécute les effets d'un composant dans
  // l'ordre, la carte existe donc déjà quand les suivants tournent au montage.

  useEffect(() => {
    const map = L.map(containerRef.current!, { maxZoom: MAP_MAX_ZOOM }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    // Au-dessus des couronnes (overlayPane, z-index 400), qui sont redessinées à chaque rechargement.
    map.createPane(DIAGNOSTIC_PANE).style.zIndex = '450';
    const handles: MapHandles = {
      map,
      baseLayer: null,
      crownsLayer: null,
      pathsByCrownId: new Map(),
      crownsById: new Map(),
      userLocationMarker: null,
      lidarOverlay: null,
      framed: false,
    };
    handlesRef.current = handles;

    let cancelled = false;
    void loadLidarOverlay().then((layer) => {
      if (!cancelled) {
        handles.lidarOverlay = layer;
        setLidarOverlayAvailable(layer !== null);
      }
    });
    void reloadCrowns();

    return () => {
      cancelled = true;
      // Leaflet 1.9 termine chaque animation de zoom par un setTimeout non annulé par
      // remove() : quitter la carte en plein zoom ferait planter ce rappel (« _leaflet_pos »).
      // Il s'arrête de lui-même si ce drapeau interne est retombé.
      (map as unknown as { _animatingZoom: boolean })._animatingZoom = false;
      map.remove();
      handlesRef.current = null;
      setLidarOverlayVisible(false);
    };
  }, []);

  // Remplace le fond de carte courant, sous les couronnes (ajoutées dans leur propre calque).
  useEffect(() => {
    const handles = handlesRef.current!;
    handles.baseLayer?.remove();
    handles.baseLayer = findBaseLayer(baseLayerId).create().addTo(handles.map);
  }, [baseLayerId]);

  // Trace toutes les couronnes et recadre la carte sur celles qui sont identifiées.
  useEffect(() => {
    const handles = handlesRef.current!;
    handles.crownsLayer?.remove();
    handles.pathsByCrownId.clear();
    handles.crownsById.clear();

    // Couronnes non identifiées d'abord : les fiches sont dessinées par-dessus et
    // restent cliquables là où un cercle GPS recouvre une couronne.
    const ordered: CrownFeature[] = [...features].sort(
      (a, b) => Number(isIdentified(a.properties)) - Number(isIdentified(b.properties)),
    );
    const identifiedPaths: L.Path[] = [];
    const crownsLayer = L.geoJSON(ordered, {
      style: (feature) => crownStyle(feature!.properties as Crown, 'normal'),
      onEachFeature: (feature, layer) => {
        const crown = feature.properties as Crown;
        const path = layer as L.Path;
        path.on('click', () => selectCrown(crown));
        handles.pathsByCrownId.set(crown.id, path);
        handles.crownsById.set(crown.id, crown);
        if (isIdentified(crown)) {
          identifiedPaths.push(path);
        }
      },
    }).addTo(handles.map);
    handles.crownsLayer = crownsLayer;

    // Lu via la ref : la sélection ne doit pas être une dépendance de CET effet, sinon
    // tout serait redessiné (et recadré) à chaque changement de recherche.
    const selected = selectedRef.current;
    applyHighlight(handles, selected);

    // Arrivée avec une sélection déjà faite (ex. clic dans la liste) : on cadre dessus
    // plutôt que sur l'ensemble des fiches.
    const selectedPath = selected ? handles.pathsByCrownId.get(selected.id) : undefined;
    const framed = selectedPath ?? (identifiedPaths.length ? L.featureGroup(identifiedPaths) : crownsLayer);
    const bounds = (framed as L.Polygon | L.FeatureGroup).getBounds();
    if (!handles.framed && bounds.isValid()) {
      handles.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 19 });
      handles.framed = true;
    }
  }, [features]);

  // Surbrillance, puis recentrage sur la couronne sélectionnée si elle est hors champ
  // (recherche, Précédent/Suivant), sans toucher au zoom choisi par l'utilisateur.
  useEffect(() => {
    const handles = handlesRef.current!;
    applyHighlight(handles, selectedCrown);
    const path = selectedCrown ? handles.pathsByCrownId.get(selectedCrown.id) : undefined;
    if (!path) {
      return;
    }
    const center = (path as L.Polygon).getBounds().getCenter();
    if (!handles.map.getBounds().contains(center)) {
      handles.map.panTo(center);
    }
  }, [selectedCrown]);

  // Position GPS courante de l'utilisateur, sans jamais recadrer la carte dessus : elle
  // bouge en continu et ne doit pas faire sauter la vue pendant la consultation.
  useEffect(() => {
    const handles = handlesRef.current!;
    if (!currentReading) {
      handles.userLocationMarker?.remove();
      handles.userLocationMarker = null;
      return;
    }
    const latLng: L.LatLngTuple = [currentReading.latitude, currentReading.longitude];
    if (handles.userLocationMarker) {
      handles.userLocationMarker.setLatLng(latLng);
    } else {
      handles.userLocationMarker = L.circleMarker(latLng, {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#1A73E8',
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip('Votre position')
        .addTo(handles.map);
    }
  }, [currentReading]);

  // --- Actions -----------------------------------------------------------------

  const selectBaseLayer = (id: string) => {
    setBaseLayerId(id);
    storeBaseLayer(id);
  };

  const toggleLidarOverlay = () => {
    const handles = handlesRef.current;
    if (!handles?.lidarOverlay) {
      return;
    }
    const visible = !lidarOverlayVisible;
    setLidarOverlayVisible(visible);
    if (visible) {
      handles.lidarOverlay.addTo(handles.map);
    } else {
      handles.lidarOverlay.remove();
    }
  };

  /** Masque ("supprime") ou restaure la couronne sélectionnée, avec annulation possible. */
  const toggleHidden = async (crown: Crown) => {
    if (!canHide(crown) || hiding) {
      return;
    }
    const hide = !crown.hidden;
    if (
      hide &&
      isIdentified(crown) &&
      !window.confirm(
        `Cette couronne porte la fiche ${crown.reference ?? ''}. La masquer détache ses relevés, ` +
          'qui seront affichés comme simples positions GPS. Continuer ?',
      )
    ) {
      return;
    }
    setHiding(true);
    try {
      await setCrownHidden(crown, hide);
      showToast(hide ? 'Couronne masquée.' : 'Couronne restaurée.', {
        action: 'Annuler',
        duration: 5000,
        onAction: () =>
          setCrownHidden({ ...crown, hidden: hide }, !hide).catch(() =>
            showToast("Échec de l'annulation.", { action: 'Fermer', duration: 5000 }),
          ),
      });
    } catch {
      showToast('Échec de la modification, veuillez réessayer.', { action: 'Fermer', duration: 5000 });
    } finally {
      setHiding(false);
    }
  };

  /** Passe à la fiche précédente/suivante du catalogue, en bouclant aux extrémités. */
  const navigate = (step: 1 | -1) => {
    const reference = selectedCrown?.reference;
    const index = reference ? sortedReferences.indexOf(reference) : -1;
    if (index === -1) {
      return;
    }
    const nextReference = sortedReferences[(index + step + sortedReferences.length) % sortedReferences.length];
    const nextCrown = identifiedCrowns.find((crown) => crown.reference === nextReference);
    if (nextCrown) {
      selectCrown(nextCrown);
    }
  };

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="size-full" />

      <BaseLayerPicker
        baseLayerId={baseLayerId}
        onSelect={selectBaseLayer}
        besidePanel={selectedCrown !== null}
        lidarOverlayAvailable={lidarOverlayAvailable}
        lidarOverlayVisible={lidarOverlayVisible}
        onToggleLidarOverlay={toggleLidarOverlay}
      />

      {(loading || error) && (
        <div
          className={`absolute top-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded bg-white/95 px-4 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.3)] ${loading ? '' : 'text-danger'}`}
        >
          {loading ? (
            <Spinner size={32} />
          ) : (
            <>
              <Icon name="error_outline" />
              <span>{error}</span>
            </>
          )}
        </div>
      )}

      {selectedCrown && (
        <TreePanel
          key={selectedCrown.id}
          crown={selectedCrown}
          canEdit={canEdit}
          hiding={hiding}
          canNavigate={canNavigate}
          onToggleHidden={() => void toggleHidden(selectedCrown)}
          onClose={clearSearch}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
