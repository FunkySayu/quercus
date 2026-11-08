import * as L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Icon, Spinner } from '../../components/ui';
import { type Crown, type CrownFeature, type CrownReading, canHide, isIdentified } from '../../models/crown';
import { useAuth } from '../../stores/auth';
import { useColorScheme } from '../../stores/color-scheme';
import { pushAction, setPaletteReference, setTool, undo, useEditTools } from '../../stores/edit-tools';
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
import { BaseLayerTimeline } from './BaseLayerTimeline';
import { MAP_MAX_ZOOM, findBaseLayer, loadStoredBaseLayer, storeBaseLayer } from './base-layers';
import { ColorSchemeControl } from './ColorSchemeControl';
import {
  type CrownColoring,
  type CrownState,
  buildPlantingClasses,
  compareReferences,
  crownHoverStyle,
  crownStyle,
} from './crown-style';
import { EditToolbar } from './EditToolbar';
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
  hoveredCrownId: string | null;
  userLocationMarker: L.CircleMarker | null;
  lidarOverlay: L.Layer | null;
  /** Recadrage fait une seule fois par visite de la carte : les redessins suivants
   * (rechargement, couronne masquée) ne doivent pas faire sauter la vue. */
  framed: boolean;
}

function crownState(crown: Crown, selected: Crown | null): CrownState {
  if (!selected) {
    return 'normal';
  }
  if (crown.id === selected.id) {
    return 'selected';
  }
  return isIdentified(selected) && isIdentified(crown) && crown.reference === selected.reference
    ? 'normal'
    : 'lowlight';
}

/** Style d'une couronne, survol compris. */
function displayedStyle(handles: MapHandles, crown: Crown, state: CrownState, coloring: CrownColoring): L.PathOptions {
  const style = crownStyle(crown, state, coloring);
  return crown.id === handles.hoveredCrownId ? crownHoverStyle(style) : style;
}

/** Met en avant la couronne sélectionnée et celles de la même fiche, estompe les autres. */
function applyHighlight(handles: MapHandles, selected: Crown | null, coloring: CrownColoring): void {
  handles.pathsByCrownId.forEach((path, id) => {
    const crown = handles.crownsById.get(id);
    if (!crown) {
      return;
    }
    const state = crownState(crown, selected);
    path.setStyle(displayedStyle(handles, crown, state, coloring));
    // Seule une fiche passe au premier plan : une couronne non identifiée remontée
    // masquerait ensuite les cercles GPS posés dessus.
    if (state === 'selected' && isIdentified(crown)) {
      path.bringToFront();
    }
  });
}

/**
 * Masque (ou restaure) une couronne et inscrit l'opération dans l'historique
 * annuler/rétablir de la barre d'outils. Demande confirmation avant de détacher
 * les relevés d'une fiche. Renvoie false si l'utilisateur a renoncé.
 */
async function hideWithHistory(crown: Crown, hide: boolean): Promise<boolean> {
  if (
    hide &&
    isIdentified(crown) &&
    !window.confirm(
      `Cette couronne porte la fiche ${crown.reference ?? ''}. La masquer détache ses relevés, ` +
        'qui seront affichés comme simples positions GPS. Continuer ?',
    )
  ) {
    return false;
  }
  await setCrownHidden(crown, hide);
  const before = { ...crown, hidden: !hide };
  const after = { ...crown, hidden: hide };
  pushAction({
    label: hide ? 'Couronne masquée.' : 'Couronne restaurée.',
    undo: () => setCrownHidden(after, !hide),
    redo: () => setCrownHidden(before, hide),
  });
  return true;
}

/**
 * Attribue la fiche de la palette à une couronne LiDAR non identifiée, en créant un
 * relevé à son sommet (précision 0) : le backend le rattache en direct à la couronne
 * qui le contient, et une régénération LiDAR le retrouvera `inside`. Annulable (le
 * relevé est supprimé). Une couronne portant déjà une fiche n'est pas repeinte : ce
 * serait réécrire des relevés de terrain.
 */
async function paintCrown(crown: Crown): Promise<void> {
  const reference = useEditTools.getState().paletteReference;
  if (!reference) {
    showToast('Choisissez d’abord une fiche dans la palette.');
    return;
  }
  if (crown.hidden || crown.source !== 'lidar' || !crown.top) {
    showToast(crown.hidden ? 'Couronne masquée : restaurez-la d’abord.' : 'Seules les couronnes LiDAR peuvent être peintes.');
    return;
  }
  if (isIdentified(crown)) {
    showToast(
      crown.reference === reference
        ? 'Cette couronne porte déjà cette fiche.'
        : `Cette couronne porte déjà la fiche ${crown.reference ?? ''}.`,
    );
    return;
  }
  const [longitude, latitude] = crown.top;
  const create = () => api.createTree({ latitude, longitude, accuracy: 0, reference, name: null });
  try {
    let treeId = (await create()).id;
    await reloadCrowns();
    pushAction({
      label: `Fiche ${reference} attribuée.`,
      undo: async () => {
        await api.deleteTree(treeId);
        await reloadCrowns();
      },
      redo: async () => {
        treeId = (await create()).id;
        await reloadCrowns();
      },
    });
    showToast(`Fiche ${reference} attribuée.`);
  } catch {
    showToast("Échec de l'attribution, veuillez réessayer.", { action: 'Fermer', duration: 5000 });
  }
}

/** Relevé créé par la peinture (voir `paintCrown`) : précision 0, sans nom saisi. */
function isPainted(reading: CrownReading): boolean {
  return reading.accuracy === 0 && !reading.name;
}

/**
 * Retire la fiche d'une couronne peinte en supprimant ses relevés de peinture.
 * Refusé si la couronne porte un relevé de terrain : on ne les efface pas d'ici.
 * Annulable (les relevés sont recréés aux mêmes positions).
 */
async function eraseCrown(crown: Crown): Promise<void> {
  if (!isIdentified(crown)) {
    showToast('Cette couronne n’a pas de fiche à effacer.');
    return;
  }
  if (!crown.readings.every(isPainted)) {
    showToast('Cette couronne porte un relevé de terrain : sa fiche ne peut pas être effacée ici.');
    return;
  }
  const painted = crown.readings.map(({ latitude, longitude, reference }) => ({ latitude, longitude, reference }));
  let ids = crown.readings.map((reading) => reading.id);
  const remove = async () => {
    await Promise.all(ids.map((id) => api.deleteTree(id)));
    await reloadCrowns();
  };
  try {
    await remove();
    const label = `Fiche ${crown.reference ?? ''} effacée.`;
    pushAction({
      label,
      undo: async () => {
        const created = await Promise.all(
          painted.map((reading) => api.createTree({ ...reading, accuracy: 0, name: null })),
        );
        ids = created.map((tree) => tree.id);
        await reloadCrowns();
      },
      redo: remove,
    });
    showToast(label);
  } catch {
    showToast("Échec de l'effacement, veuillez réessayer.", { action: 'Fermer', duration: 5000 });
  }
}

/** Clic sur une couronne : selon l'outil actif de la barre d'édition (connecté seulement). */
function onCrownClick(crown: Crown): void {
  const tool = useAuth.getState().authenticated ? useEditTools.getState().tool : 'cursor';
  switch (tool) {
    case 'cursor':
      selectCrown(crown);
      return;
    case 'pipette':
      if (!crown.reference || !isIdentified(crown)) {
        showToast("Cette couronne n'a pas de fiche à prélever.");
        return;
      }
      setPaletteReference(crown.reference);
      setTool('paint');
      return;
    case 'paint':
      void paintCrown(crown);
      return;
    case 'erase':
      void eraseCrown(crown);
      return;
    case 'delete':
      if (!canHide(crown) || crown.hidden) {
        showToast(crown.hidden ? 'Couronne déjà masquée.' : 'Seules les couronnes LiDAR peuvent être masquées.');
        return;
      }
      hideWithHistory(crown, true).then(
        (done) => done && showToast('Couronne masquée.'),
        () => showToast('Échec de la modification, veuillez réessayer.', { action: 'Fermer', duration: 5000 }),
      );
      return;
  }
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

  /** Mode de coloration des couronnes (sélecteur en haut à gauche, voir crown-style.ts). */
  const scheme = useColorScheme((s) => s.scheme);
  const crowns = useMemo(() => features.map((feature) => feature.properties), [features]);
  const plantingClasses = useMemo(
    () => buildPlantingClasses(crowns.filter((crown) => !crown.hidden)),
    [crowns],
  );
  const coloring = useMemo<CrownColoring>(() => ({ scheme, plantingClasses }), [scheme, plantingClasses]);
  const coloringRef = useRef(coloring);
  coloringRef.current = coloring;

  /** Masquer/restaurer une couronne : réservé aux utilisateurs connectés (le backend
   * ne leur renvoie qu'à eux les couronnes masquées). */
  const canEdit = useAuth((s) => s.authenticated === true);
  const tool = useEditTools((s) => s.tool);
  const [hiding, setHiding] = useState(false);

  /** Fond de carte choisi dans la frise en bas de la carte (voir base-layers.ts). */
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
    // Sans boutons +/- : zoom à la molette / au pincement, le coin reste à la légende.
    const map = L.map(containerRef.current!, { maxZoom: MAP_MAX_ZOOM, zoomControl: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    // Au-dessus des couronnes (overlayPane, z-index 400), qui sont redessinées à chaque rechargement.
    map.createPane(DIAGNOSTIC_PANE).style.zIndex = '450';
    const handles: MapHandles = {
      map,
      baseLayer: null,
      crownsLayer: null,
      pathsByCrownId: new Map(),
      crownsById: new Map(),
      hoveredCrownId: null,
      userLocationMarker: null,
      lidarOverlay: null,
      framed: false,
    };
    handlesRef.current = handles;

    // Clic hors de toute couronne : retire la sélection.
    map.on('click', () => {
      if (selectedRef.current) {
        clearSearch();
      }
    });

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
    // Un tracé retiré sous le curseur ne reçoit jamais son `mouseout`.
    handles.hoveredCrownId = null;
    // Au toucher, le navigateur simule un survol qui resterait collé après le tap.
    const canHover = window.matchMedia('(hover: hover)').matches;

    // Couronnes non identifiées d'abord : les fiches sont dessinées par-dessus et
    // restent cliquables là où un cercle GPS recouvre une couronne.
    const ordered: CrownFeature[] = [...features].sort(
      (a, b) => Number(isIdentified(a.properties)) - Number(isIdentified(b.properties)),
    );
    const identifiedPaths: L.Path[] = [];
    const crownsLayer = L.geoJSON(ordered, {
      style: (feature) => crownStyle(feature!.properties as Crown, 'normal', coloringRef.current),
      onEachFeature: (feature, layer) => {
        const crown = feature.properties as Crown;
        const path = layer as L.Path;
        path.on('click', (event) => {
          // Sinon le clic remonte à la carte, qui annulerait aussitôt la sélection.
          L.DomEvent.stopPropagation(event);
          onCrownClick(crown);
        });
        if (canHover) {
          const setHovered = (hovered: boolean) => {
            handles.hoveredCrownId = hovered ? crown.id : null;
            const state = crownState(crown, selectedRef.current);
            path.setStyle(displayedStyle(handles, crown, state, coloringRef.current));
          };
          path.on('mouseover', () => setHovered(true));
          path.on('mouseout', () => setHovered(false));
        }
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
    applyHighlight(handles, selected, coloringRef.current);

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
    applyHighlight(handles, selectedCrown, coloringRef.current);
    const path = selectedCrown ? handles.pathsByCrownId.get(selectedCrown.id) : undefined;
    if (!path) {
      return;
    }
    const center = (path as L.Polygon).getBounds().getCenter();
    if (!handles.map.getBounds().contains(center)) {
      handles.map.panTo(center);
    }
  }, [selectedCrown]);

  // Changement de mode de coloration : simple restylage, sans redessiner les couronnes.
  useEffect(() => {
    applyHighlight(handlesRef.current!, selectedRef.current, coloring);
  }, [coloring]);

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
    setHiding(true);
    try {
      if (await hideWithHistory(crown, hide)) {
        showToast(hide ? 'Couronne masquée.' : 'Couronne restaurée.', {
          action: 'Annuler',
          duration: 5000,
          onAction: () =>
            undo().catch(() => showToast("Échec de l'annulation.", { action: 'Fermer', duration: 5000 })),
        });
      }
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
    // Classe d'outil sur l'enveloppe, jamais sur le conteneur Leaflet : React y écraserait
    // les classes posées par Leaflet (leaflet-container…) et la carte deviendrait blanche.
    <div className={`relative h-full ${canEdit ? `map-tool-${tool}` : ''}`}>
      <div ref={containerRef} className="size-full" />

      <ColorSchemeControl crowns={crowns} coloring={coloring} />

      <BaseLayerTimeline
        baseLayerId={baseLayerId}
        onSelect={selectBaseLayer}
        besidePanel={selectedCrown !== null}
        lidarOverlayAvailable={lidarOverlayAvailable}
        lidarOverlayVisible={lidarOverlayVisible}
        onToggleLidarOverlay={toggleLidarOverlay}
        toolbar={canEdit ? <EditToolbar /> : undefined}
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
