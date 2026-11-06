import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { BackToMap, buttonClass, Icon, linkClass, Spinner } from '../components/ui';
import { formatDateTime, formatNumber } from '../format';
import { type Crown, bestAccuracy, lastReadingDate, plantingLabel } from '../models/crown';
import { reloadCrowns, selectCrown, useCrowns, useIdentifiedCrowns } from '../stores/crowns';

const COLUMNS = ['Référence', 'Espèce', 'Contour', 'Plantation', 'Coordonnées', 'Précision', 'Date de saisie'];

/** Un arbre identifié par ligne (couronne LiDAR ou cercle GPS), du plus récemment relevé au plus ancien. */
export default function ListingPage() {
  const loading = useCrowns((s) => s.loading);
  const error = useCrowns((s) => s.error);
  const identified = useIdentifiedCrowns();
  const navigate = useNavigate();

  const crowns = useMemo(
    () => [...identified].sort((a, b) => (lastReadingDate(b) ?? '').localeCompare(lastReadingDate(a) ?? '')),
    [identified],
  );

  useEffect(() => {
    void reloadCrowns();
  }, []);

  /** Ouvre l'arbre sur la carte, sélectionné (panneau de détail ouvert). */
  const showOnMap = (crown: Crown) => {
    selectCrown(crown);
    void navigate('/');
  };

  return (
    <div className="mx-auto my-6 max-w-[900px] px-4 pb-12">
      <BackToMap />
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-medium">Arbres saisis</h2>
        <button type="button" className={buttonClass.stroked} disabled={loading} onClick={() => void reloadCrowns()}>
          <Icon name="refresh" className="text-xl" />
          Actualiser
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : error ? (
        <div className="p-6 text-center text-danger">Impossible de charger la liste des arbres.</div>
      ) : crowns.length === 0 ? (
        <div className="p-6 text-center text-black/60">Aucun arbre enregistré pour le moment.</div>
      ) : (
        <div className="overflow-x-auto rounded-md bg-white shadow ring-1 ring-black/5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-xs font-medium text-black/60">
                {COLUMNS.map((column) => (
                  <th key={column} className="px-4 py-3 font-medium whitespace-nowrap">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crowns.map((crown) => (
                <ListingRow key={crown.id} crown={crown} onClick={() => showOnMap(crown)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListingRow({ crown, onClick }: { crown: Crown; onClick: () => void }) {
  const speciesName = crown.nom_usage || crown.nom_scientifique || crown.name;
  return (
    <tr className="cursor-pointer border-b border-black/10 last:border-0 hover:bg-black/[0.04]" onClick={onClick}>
      <td className="px-4 py-3">{crown.reference || '—'}</td>
      <td className="px-4 py-3">
        {speciesName ? (
          crown.wikipedia_url ? (
            <a
              href={crown.wikipedia_url}
              target="_blank"
              rel="noopener"
              className={linkClass}
              onClick={(event) => event.stopPropagation()}
            >
              {speciesName}
            </a>
          ) : (
            speciesName
          )
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3">
        {crown.source === 'lidar' ? `Couronne LiDAR · ${formatNumber(crown.height_m, 0, 0)} m` : 'GPS seul'}
      </td>
      <td className="px-4 py-3">{plantingLabel(crown) || '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {crown.top && `${formatNumber(crown.top[1], 6, 6)}, ${formatNumber(crown.top[0], 6, 6)}`}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        ±{formatNumber(bestAccuracy(crown), 0, 0)} m
        {crown.readings.length > 1 && <small className="ml-1">({crown.readings.length} relevés)</small>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(lastReadingDate(crown))}</td>
    </tr>
  );
}
