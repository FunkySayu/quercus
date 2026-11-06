/**
 * Couleur par fiche du catalogue, pour le mode de coloration « Espèce » de la carte.
 *
 * Palette : les 100 premières couleurs de Glasbey « light » (colorcet
 * `glasbey_light`, construite par éloignement maximal dans l'espace perceptuel
 * CAM02-UCS ; écart minimal ≈ 10 ΔE entre deux couleurs). Variante claire et
 * saturée (luminance ≥ 42, chroma ≥ 20) : pas de couleur trop sombre pour se lire
 * sur les photos aériennes, pas de gris confondu avec les couronnes non identifiées.
 *
 * Attribution : une couleur « thématique » a été proposée pour chaque fiche d'après
 * sa description (feuillage d'automne, revers des feuilles, écorce, nom…), puis
 * ramenée à la couleur de palette la plus proche par affectation optimale (une
 * couleur distincte par fiche). Le commentaire de chaque ligne rappelle l'intention.
 * Une fiche créée depuis sur le terrain (absente de la table) reçoit une couleur
 * libre de la palette, choisie de façon stable d'après sa référence.
 */

/** Glasbey light, 100 couleurs, dans l'ordre de construction (les premières sont les plus distinctes). */
export const SPECIES_PALETTE: readonly string[] = [
  '#D60000', '#018700', '#B500FF', '#05ACC6', '#97FF00', '#FFA52F', '#FF8EC8', '#79525E', '#00FDCF', '#AFA5FF',
  '#93AC83', '#9A6900', '#366962', '#D3008C', '#FDF490', '#C86E66', '#9EE2FF', '#00C846', '#A877AC', '#B8BA01',
  '#F4BFB1', '#FF28FD', '#F2CDFF', '#009E7C', '#FF6200', '#56642A', '#953F1F', '#90318E', '#FF3464', '#A0E491',
  '#8C9AB1', '#829026', '#AE083F', '#77C6BA', '#BC9157', '#E48EFF', '#72B8FF', '#C6A5C1', '#FF9070', '#D3C37C',
  '#BCEDDB', '#6B8567', '#916E56', '#F9FF00', '#BAC1DF', '#AC567C', '#FFCD03', '#FF49B1', '#C15603', '#5D8C90',
  '#C144BC', '#00753F', '#BA6EFD', '#00D493', '#00FF75', '#49A150', '#CC9790', '#00EBED', '#DB7E01', '#F77589',
  '#B89500', '#C84248', '#00CFF9', '#755726', '#85D401', '#EBFFD4', '#A77B87', '#DB72C8', '#CAE256', '#8ABF5D',
  '#A1216B', '#855B89', '#89BACF', '#FFBAD6', '#B6CFAA', '#97414D', '#67AA00', '#FDE1B1', '#FF3628', '#80793D',
  '#D6E8FF', '#A795C6', '#7EA59A', '#D182A3', '#54823B', '#E6A872', '#9CFFFF', '#DA5480', '#05B3AA', '#FFAAF6',
  '#D1AFEF', '#DA015D', '#AC1A13', '#60B385', '#D442FD', '#ACAA59', '#FB9CA7', '#B3723B', '#F26952', '#AED1D4',
];

const SPECIES_COLORS: Record<string, string> = {
  1: '#366962', // Quercus rysophylla — slate gray
  2: '#AC1A13', // Quercus agrifolia — oxblood red
  3: '#AE083F', // Quercus rubra — crimson
  4: '#FDE1B1', // Quercus aliena — ivory felt
  6: '#B89500', // Quercus variabilis — old gold
  11: '#54823B', // Quercus coccifera subsp. calliprinos — glossy green
  16: '#DB7E01', // Quercus trojana — burnt orange
  19: '#855B89', // Quercus vacciniifolia — huckleberry violet
  20: '#B3723B', // Quercus chenii — bronze
  21: '#DA5480', // Quercus palustris — rose red
  22: '#FFA52F', // Quercus phellos — tangerine
  23: '#BC9157', // Quercus frainetto — fawn
  24: '#05ACC6', // Quercus glauca — steel blue
  '24 Bis': '#90318E', // Quercus hartwissiana — dark plum
  26: '#C86E66', // Quercus polymorpha — rust
  27: '#916E56', // Quercus macrocarpa — dark taupe
  29: '#97414D', // Quercus texana — mahogany
  30: '#FFCD03', // Quercus velutina — saffron
  31: '#60B385', // Quercus castaneifolia — chestnut-leaf sage
  '31 Bis': '#953F1F', // Quercus macranthera — auburn
  33: '#755726', // Quercus acutissima — sawtooth brown
  '33 Bis': '#56642A', // Quercus libani — cedar green
  34: '#D60000', // Quercus texana — brick red
  35: '#89BACF', // Quercus douglasii — powder blue
  36: '#00753F', // Quercus wislizeni — deep evergreen
  37: '#D3C37C', // Quercus chrysolepis — golden buff
  38: '#8C9AB1', // Quercus bicolor — silver gray
  39: '#009E7C', // Quercus muehlenbergii — glaucous teal
  40: '#49A150', // Quercus phillyreoides — jade
  41: '#A1216B', // Quercus alba — wine
  '41 Bis': '#79525E', // Quercus kelloggii — jet black
  42: '#5D8C90', // Quercus nigra — pewter
  44: '#A77B87', // Quercus georgiana — granite gray
  46: '#B500FF', // Quercus myrsinifolia — amethyst
  47: '#FF3628', // Quercus coccinea — scarlet
  49: '#C15603', // Quercus cerris — terracotta
  50: '#AC567C', // Quercus pagoda — cherry-bark brown
  '50 Bis': '#93AC83', // Quercus virginiana — lichen gray-green
  '50 Ter': '#8ABF5D', // Quercus dentata — kashiwa green
  52: '#B6CFAA', // Quercus pyrenaica — pale rose-green
  53: '#ACAA59', // Quercus frainetto — fawn
  54: '#6B8567', // Quercus pedunculiflora — olive gray
  55: '#DA015D', // Quercus coccifera — kermes crimson
  56: '#7EA59A', // Quercus falcata — silver sage
  57: '#CC9790', // Quercus imbricaria — shingle tan
  59: '#9A6900', // Quercus ilex subsp. ballota — chestnut brown
  60: '#E6A872', // Quercus suber — cork tan
  61: '#F26952', // Quercus acerifolia — maple orange-red
  62: '#F4BFB1', // Quercus miquihuanensis — dusty stone
  63: '#C84248', // Quercus galeanensis — vermilion
  64: '#AED1D4', // Quercus hypoleucoides — silver
  65: '#80793D', // Quercus stellata — olive khaki
  67: '#EBFFD4', // Quercus leucotrichophora — ivory frost
};

const FREE_COLORS = SPECIES_PALETTE.filter((color) => !Object.values(SPECIES_COLORS).includes(color));

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Fiche « Quercus sp. (à identifier) » : pas une espèce, elle reste en gris neutre. */
const PLACEHOLDER_REFERENCE = '0';

/** Couleur de la fiche, ou null (pas de fiche, ou fiche « à identifier »). */
export function speciesColor(reference: string | null | undefined): string | null {
  if (!reference || reference === PLACEHOLDER_REFERENCE) {
    return null;
  }
  return SPECIES_COLORS[reference] ?? FREE_COLORS[hashString(reference) % FREE_COLORS.length];
}
