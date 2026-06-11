/**
 * Configuration du moteur de recommandation « threads génériques » (US).
 * Objectif : fils actifs, non polémiques, à valeur ajoutée.
 */

/** Subreddits US sûrs et pertinents (voyage, lifestyle, productivité, télétravail…). */
export const SAFE_SUBREDDITS_US = [
  "travel",
  "solotravel",
  "TravelHacks",
  "hotels",
  "digitalnomad",
  "remotework",
  "WorkFromHome",
  "productivity",
  "lifehacks",
  "Frugal",
  "AskNYC",
  "coworking",
];

/**
 * Mots-clés polémiques / politiques / débats de société → on écarte le post.
 * Recherchés dans le titre (insensible à la casse).
 */
export const POLEMIC_KEYWORDS = [
  "politic", "election", "trump", "biden", "republican", "democrat", "congress",
  "abortion", "gun", "shooting", "race", "racis", "religio", "god ", "church",
  "war", "israel", "palestin", "gaza", "ukraine", "russia",
  "immigration", "migrant", "vaccine", "covid", "lockdown",
  "lgbt", "trans ", "gender", "feminis", "woke", "protest", "riot",
  "climate change", "abuse", "suicide", "depression", "divorce", "lawsuit",
];

/** Bornes du « sweet spot » d'engagement. */
export const MIN_COMMENTS = 5;
export const MAX_COMMENTS = 150;

/** Âge max d'un post pour être recommandé (heures). */
export const MAX_AGE_HOURS = 24;

/** Indices de « valeur ajoutée » dans le titre (questions / demandes de conseil). */
export const VALUE_SIGNALS = [
  "?", "looking for", "recommend", "suggestion", "advice", "best ", "how do",
  "how to", "where ", "what ", "tips", "help", "ideas", "worth it",
];

/** Nombre de recommandations renvoyées par compte. */
export const TOP_N = 15;
