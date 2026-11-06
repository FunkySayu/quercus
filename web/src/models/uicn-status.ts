/** Catégories de la Liste rouge de l'UICN pertinentes pour le quercitum, du
 * moins préoccupant (LC, vert) au plus menacé (CR, rouge). DD et NA ne font
 * pas partie du dégradé de menace : ce sont des cas où l'évaluation elle-même
 * est absente ou non pertinente. */
export interface UicnStatus {
  code: string;
  label: string;
  description: string;
  color: string;
}

const KNOWN_STATUSES: readonly UicnStatus[] = [
  {
    code: 'LC',
    label: 'Préoccupation mineure',
    color: '#2E7D32',
    description:
      "L'espèce a été évaluée mais ne remplit pas les critères des catégories menacées : sa population est jugée stable ou son déclin trop faible pour représenter un risque d'extinction à court terme.",
  },
  {
    code: 'NT',
    label: 'Quasi menacée',
    color: '#9E9D24',
    description:
      "L'espèce est proche de remplir les critères des catégories menacées, ou pourrait les remplir dans un futur proche si les pressions qu'elle subit ne sont pas atténuées.",
  },
  {
    code: 'VU',
    label: 'Vulnérable',
    color: '#F9A825',
    description: "L'espèce est confrontée à un risque élevé d'extinction à l'état sauvage.",
  },
  {
    code: 'EN',
    label: 'En danger',
    color: '#EF6C00',
    description: "L'espèce est confrontée à un risque très élevé d'extinction à l'état sauvage.",
  },
  {
    code: 'CR',
    label: 'En danger critique',
    color: '#C62828',
    description:
      "L'espèce est confrontée à un risque extrêmement élevé d'extinction à l'état sauvage : c'est la catégorie la plus grave avant les extinctions (EW, EX).",
  },
  {
    code: 'DD',
    label: 'Données insuffisantes',
    color: '#757575',
    description:
      "Les données disponibles sont insuffisantes pour évaluer, directement ou indirectement, le risque d'extinction de cette espèce.",
  },
  {
    code: 'NA',
    label: 'Non applicable',
    color: '#757575',
    description:
      "Cette fiche ne correspond pas à une évaluation UICN standard (identification incertaine ou taxon non reconnu).",
  },
];

const STATUSES_BY_CODE = new Map(KNOWN_STATUSES.map((status) => [status.code, status]));

/** Résout un code de statut UICN (ex. "LC") en informations d'affichage. Un code
 * inconnu retombe sur un statut neutre affichant tel quel le texte fourni, pour
 * rester tolérant aux données historiques non encore normalisées. */
export function resolveUicnStatus(code: string | null | undefined): UicnStatus | null {
  const trimmed = code?.trim();
  if (!trimmed) {
    return null;
  }
  return (
    STATUSES_BY_CODE.get(trimmed.toUpperCase()) ?? {
      code: trimmed,
      label: trimmed,
      color: '#757575',
      description: "Statut non reconnu dans la classification UICN standard (LC, NT, VU, EN, CR, DD).",
    }
  );
}
