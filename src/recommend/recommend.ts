import type { BrowserContext } from "playwright";
import {
  fetchListingJson,
  fetchSubredditPosts,
  searchReddit,
  type RedditPost,
} from "../reddit/read.js";
import { DAYUSE_PLAN, NOISE_SUBS } from "./plan.js";
import {
  MAX_AGE_HOURS,
  MAX_COMMENTS,
  MIN_COMMENTS,
  POLEMIC_KEYWORDS,
  SAFE_SUBREDDITS_US,
  TOP_N,
  VALUE_SIGNALS,
} from "./config.js";

export type Recommendation = RedditPost & {
  ageHours: number;
  scoreReco: number;
  reasons: string[];
};

function isPolemic(title: string): boolean {
  const t = title.toLowerCase();
  return POLEMIC_KEYWORDS.some((k) => t.includes(k));
}

function valueSignal(title: string): boolean {
  const t = title.toLowerCase();
  return VALUE_SIGNALS.some((s) => t.includes(s));
}

/** Filtre + score un post. Renvoie null si écarté. dayuse = critères assouplis. */
function evaluate(post: RedditPost, nowMs: number, dayuse: boolean): Recommendation | null {
  if (post.nsfw) return null;
  if (NOISE_SUBS.has(post.subreddit.toLowerCase())) return null;
  // Pour le flux Dayuse, on ne filtre pas sur les polémiques (sujets ciblés).
  if (!dayuse && isPolemic(post.title)) return null;

  const minC = dayuse ? 1 : MIN_COMMENTS;
  const maxC = dayuse ? 1000 : MAX_COMMENTS;
  if (post.commentsCount < minC || post.commentsCount > maxC) return null;

  const ageHours = (nowMs - post.createdAtMs) / 3_600_000;
  // Dayuse : on tolère des posts plus anciens (jusqu'à 7 j).
  const maxAge = dayuse ? 24 * 7 : MAX_AGE_HOURS;
  if (ageHours < -1 || ageHours > maxAge) return null;

  const reasons: string[] = [];
  let score = 0;

  if (valueSignal(post.title)) {
    score += 3;
    reasons.push("question / demande de conseil");
  }
  if (post.commentsCount >= 10 && post.commentsCount <= 80) {
    score += 2;
    reasons.push("engagement idéal");
  } else {
    score += 1;
  }
  const freshness = Math.max(0, (maxAge - ageHours) / maxAge) * 3;
  score += freshness;
  if (ageHours <= 6) reasons.push("posté récemment");
  score += Math.min(post.score / 10, 2);

  return {
    ...post,
    ageHours: Math.round(ageHours * 10) / 10,
    scoreReco: Math.round(score * 10) / 10,
    reasons,
  };
}

function rank(posts: RedditPost[], nowMs: number, dayuse: boolean): Recommendation[] {
  const seen = new Set<string>();
  const recos: Recommendation[] = [];
  for (const post of posts) {
    if (seen.has(post.fullname)) continue;
    seen.add(post.fullname);
    const r = evaluate(post, nowMs, dayuse);
    if (r) recos.push(r);
  }
  recos.sort((a, b) => b.scoreReco - a.scoreReco);
  return recos.slice(0, TOP_N);
}

/**
 * Flux générique : threads actifs, non polémiques, à valeur ajoutée, dans les
 * subreddits sûrs (listings .json authentifiés via la session du contexte).
 */
export async function recommendGeneric(
  context: BrowserContext,
  subreddits: string[] = SAFE_SUBREDDITS_US,
  nowMs: number = Date.now(),
): Promise<Recommendation[]> {
  // .json authentifié (fiable avec session) ; repli sur old.reddit HTML sinon.
  const lists = await Promise.all(
    subreddits.map((sub) =>
      fetchListingJson(context, sub, "hot", 75).catch(() =>
        fetchSubredditPosts(context, sub, "hot", 75).catch(() => [] as RedditPost[]),
      ),
    ),
  );
  return rank(lists.flat(), nowMs, false);
}

/**
 * Flux Dayuse : exécute le plan de recherche (search.json authentifié) et
 * remonte les threads pertinents pour Dayuse (day-use, spa, layover, daycation…).
 */
export async function recommendDayuse(
  context: BrowserContext,
  nowMs: number = Date.now(),
): Promise<Recommendation[]> {
  const lists = await Promise.all(
    DAYUSE_PLAN.map((query) =>
      searchReddit(context, { ...query, sort: "new", time: "month", limit: 100 }).catch(
        () => [] as RedditPost[],
      ),
    ),
  );
  return rank(lists.flat(), nowMs, true);
}
