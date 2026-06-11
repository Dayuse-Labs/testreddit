/**
 * Plan de recherche Dayuse (porté de l'extension testtest/discover.js).
 * Chaque entrée : { sub?, q }. `sub` restreint à un subreddit, sinon site-wide.
 */
export type SearchQuery = { sub?: string; q: string };

export const DAYUSE_PLAN: SearchQuery[] = [
  // SPA / bien-être
  { q: "spa day or overnight hotel" },
  { q: "hotel spa day pass" },
  { q: "couples spa day" },
  { sub: "AskNYC", q: "spa day" },
  { sub: "LosAngeles", q: "spa day" },
  { sub: "chicago", q: "day spa" },
  // LAYOVER / escale
  { q: "long layover where to rest" },
  { q: "overnight layover airport hotel" },
  { q: "day room airport" },
  { sub: "travel", q: "overnight layover hotel" },
  { sub: "TravelHacks", q: "minute suites" },
  // DAYCATION / staycation
  { q: "daycation ideas" },
  { q: "staycation hotel day" },
  { q: "pool day hotel" },
  { sub: "AskNYC", q: "daycation" },
  // DAY PASS / amenities
  { q: "hotel pool day pass" },
  { q: "resort day pass" },
  { q: "use hotel pool without staying" },
  { sub: "lasvegas", q: "hotel pool day pass" },
  // CÉLÉBRATION / couple
  { q: "hotel for date night" },
  { q: "romantic day hotel" },
  // TÉLÉTRAVAIL
  { q: "work from hotel for the day" },
  { q: "place to work for the day hotel" },
  { sub: "digitalnomad", q: "work from hotel" },
  // EARLY CHECK-IN
  { q: "early check in hotel" },
  { q: "late checkout hotel" },
  // CONCEPT day-use
  { q: "day use hotel" },
  { q: "day room hotel" },
  { q: "book hotel for a few hours" },
  { sub: "hotels", q: "day use" },
];

/** Subs hors-sujet / bruités à écarter à la source. */
export const NOISE_SUBS = new Set([
  "squaredcircle", "wwe", "aew", "pokemongo", "pokemon", "anime", "animesuggest",
  "politics", "conservative", "worldnews", "nba", "nfl", "soccer", "movies",
  "television", "gaming", "leagueoflegends", "subredditdrama", "90dayfiance",
  "wallstreetbets", "teenagers", "memes", "funny",
]);
