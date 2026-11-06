import { Fragment, useState, type ReactNode } from 'react';
import { buttonClass, Icon, linkClass } from '../../components/ui';
import { formatDateTime, formatNumber } from '../../format';
import { type Crown, canHide, isIdentified, plantingLabel } from '../../models/crown';
import { resolveUicnStatus } from '../../models/uicn-status';
import { crownSubtitle, crownTitle } from './crown-style';

interface Props {
  crown: Crown;
  canEdit: boolean;
  hiding: boolean;
  canNavigate: boolean;
  onToggleHidden: () => void;
  onClose: () => void;
  onNavigate: (step: 1 | -1) => void;
}

/**
 * Panneau de détail : latéral sur desktop ; sur mobile, panneau du bas (bottom sheet)
 * qui n'affiche d'abord que le titre/sous-titre, le reste étant déplié via "Voir plus".
 * Rendu avec `key={crown.id}` : toute nouvelle sélection repart du panneau replié.
 */
export function TreePanel({ crown, canEdit, hiding, canNavigate, onToggleHidden, onClose, onNavigate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const subtitle = crownSubtitle(crown);
  const status = resolveUicnStatus(crown.statut_uicn);
  const planting = plantingLabel(crown);
  const hideLabel = crown.hidden ? 'Restaurer la couronne' : 'Ne plus suivre cette couronne';

  return (
    <aside
      className={
        'absolute inset-y-0 right-0 z-[1000] box-border w-[min(360px,100%)] overflow-y-auto bg-white p-5 ' +
        'shadow-[-2px_0_8px_rgba(0,0,0,0.25)] ' +
        'max-sm:top-auto max-sm:left-0 max-sm:max-h-[70vh] max-sm:w-full max-sm:rounded-t-2xl max-sm:px-4 max-sm:py-3'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-medium italic">{crownTitle(crown)}</h2>
          {subtitle && <p className="mt-1 text-black/60">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && canHide(crown) && (
            <button
              type="button"
              className={buttonClass.icon}
              disabled={hiding}
              title={hideLabel}
              aria-label={hideLabel}
              onClick={onToggleHidden}
            >
              <Icon name={crown.hidden ? 'restore_from_trash' : 'delete'} />
            </button>
          )}
          <button type="button" className={buttonClass.stroked} onClick={onClose}>
            <Icon name="close" className="text-xl" />
            Fermer
          </button>
        </div>
      </div>

      {/* Mobile seulement : sur desktop tout est déjà visible. Masqué via un conteneur,
          le `inline-flex` des boutons l'emportant sinon sur `hidden`. */}
      <div className="mt-1 hidden max-sm:block">
        <button type="button" className={`${buttonClass.text} w-full`} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Voir moins' : 'Voir plus'}
          <Icon name={expanded ? 'expand_less' : 'expand_more'} />
        </button>
      </div>

      <div className={expanded ? '' : 'max-sm:hidden'}>
        <div className="mt-4">
          {crown.wikipedia_url && <ExternalLink href={crown.wikipedia_url}>Wikipédia</ExternalLink>}
          {crown.wikipedia_url && crown.powo_url && ' — '}
          {crown.powo_url && <ExternalLink href={crown.powo_url}>Plants of the World Online</ExternalLink>}
        </div>

        <Details>
          {crown.origine && <Detail term="Origine">{crown.origine}</Detail>}
          {crown.continent && <Detail term="Continent">{crown.continent}</Detail>}
          {status && (
            <Detail term="Statut UICN">
              <span className="group relative inline-block outline-none" tabIndex={0}>
                <span
                  className="inline-block cursor-default rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold tracking-[0.02em] text-white"
                  style={{ backgroundColor: status.color }}
                >
                  {status.code}
                </span>
                <span
                  role="tooltip"
                  className={
                    'pointer-events-none invisible absolute bottom-[calc(100%+8px)] left-0 z-[1001] w-[260px] translate-y-1 ' +
                    'rounded-md bg-[#262626] px-3.5 py-3 text-white opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.3)] ' +
                    'transition-[opacity,transform,visibility] duration-150 ' +
                    'group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 ' +
                    'group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100'
                  }
                >
                  <strong className="mb-1 block">{status.label}</strong>
                  <p className="text-[0.8125rem] leading-snug text-white/85">{status.description}</p>
                </span>
              </span>
              {crown.statut_uicn_url && (
                <>
                  {' '}
                  <a href={crown.statut_uicn_url} target="_blank" rel="noopener" className={linkClass}>
                    {crown.statut_uicn_annee || 'Dernière évaluation'}
                  </a>
                </>
              )}
            </Detail>
          )}
        </Details>

        {crown.description?.split('\n').map((paragraph, index) => (
          <p key={index} className="my-4 leading-normal whitespace-pre-line">
            {paragraph}
          </p>
        ))}

        {isIdentified(crown) && <hr className="border-black/15" />}

        <Details>
          {crown.reference && <Detail term="Référence">{crown.reference}</Detail>}
          <Detail term="Contour">
            {crown.source === 'lidar'
              ? `Couronne LiDAR n° ${crown.crown_id}`
              : 'Position GPS (aucune couronne LiDAR rattachée)'}
          </Detail>
          {crown.height_m !== null && <Detail term="Hauteur">{formatNumber(crown.height_m, 0, 1)} m</Detail>}
          {crown.source === 'lidar' && crown.diameter_m !== null && (
            <Detail term="Diamètre">{formatNumber(crown.diameter_m, 0, 1)} m</Detail>
          )}
          {planting && <Detail term="Plantation">{planting} (estimation)</Detail>}
          {crown.readings.map((reading, index) => (
            <Detail key={reading.id} term={crown.readings.length > 1 ? `Relevé ${index + 1}` : 'Relevé'}>
              {formatDateTime(reading.created_at)} · ±{formatNumber(reading.accuracy, 0, 0)} m
              {reading.dist_to_top_m !== null &&
                reading.match !== 'unmatched' &&
                ` · ${formatNumber(reading.dist_to_top_m, 0, 1)} m du sommet`}
            </Detail>
          ))}
        </Details>

        {canNavigate && (
          <div className="mt-4 flex justify-between gap-2">
            <button type="button" className={buttonClass.stroked} onClick={() => onNavigate(-1)}>
              <Icon name="chevron_left" />
              Précédent
            </button>
            <button type="button" className={buttonClass.stroked} onClick={() => onNavigate(1)}>
              Suivant
              <Icon name="chevron_right" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:text-primary-dark">
      <span className="underline underline-offset-2">{children}</span>
      <Icon name="open_in_new" className="text-lg" />
    </a>
  );
}

function Details({ children }: { children: ReactNode }) {
  return <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">{children}</dl>;
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <Fragment>
      <dt className="text-black/60">{term}</dt>
      <dd>{children}</dd>
    </Fragment>
  );
}
