import type { BrowserContext } from "playwright";
import { fetchSubredditPosts, type RedditPost } from "../reddit/read.js";
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

/** Filtre + score un post. Renvoie null si écarté. */
function evaluate(post: RedditPost, nowMs: number): Recommendation | null {
  if (post.nsfw) return null;
  if (post.commentsCount < MIN_COMMENTS || post.commentsCount > MAX_COMMENTS) return null;
  if (isPolemic(post.title)) return null;

  // createdAtMs vient de data-timestamp (déjà en millisecondes).
  const ageHours = (nowMs - post.createdAtMs) / 3_600_000;
  if (ageHours < -1 || ageHours > MAX_AGE_HOURS) return null;

  const reasons: string[] = [];
  let score = 0;

  if (valueSignal(post.title)) {
    score += 3;
    reasons.push("question / demande de conseil");
  }
  // Sweet spot d'engagement (cœur de la fourchette = mieux vu sans être noyé).
  if (post.commentsCount >= 10 && post.commentsCount <= 80) {
    score += 2;
    reasons.push("engagement idéal");
  } else {
    score += 1;
  }
  // Fraîcheur : plus c'est récent, mieux c'est.
  const freshness = Math.max(0, (MAX_AGE_HOURS - ageHours) / MAX_AGE_HOURS) * 3;
  score += freshness;
  if (ageHours <= 6) reasons.push("posté récemment");
  // Légère prime aux upvotes.
  score += Math.min(post.score / 10, 2);

  return { ...post, ageHours: Math.round(ageHours * 10) / 10, scoreReco: Math.round(score * 10) / 10, reasons };
}

/**
 * Scanne les subreddits sûrs et renvoie les meilleurs threads génériques où
 * apporter de la valeur (non polémiques, actifs, récents).
 */
export async function recommendGeneric(
  context: BrowserContext,
  subreddits: string[] = SAFE_SUBREDDITS_US,
  nowMs: number = Date.now(),
): Promise<Recommendation[]> {
  // "hot" = posts actifs (engagement réel), encore récents pour la plupart.
  const lists = await Promise.all(
    subreddits.map((sub) =>
      fetchSubredditPosts(context, sub, "hot", 50).catch(() => [] as RedditPost[]),
    ),
  );

  const recos: Recommendation[] = [];
  for (const posts of lists) {
    for (const post of posts) {
      const r = evaluate(post, nowMs);
      if (r) recos.push(r);
    }
  }

  recos.sort((a, b) => b.scoreReco - a.scoreReco);
  return recos.slice(0, TOP_N);
}
