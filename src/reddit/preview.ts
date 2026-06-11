import type { BrowserContext } from "playwright";
import { BROWSER_USER_AGENT } from "../config.js";
import { parseRedditUrl, type RedditTarget } from "./url.js";

export type ThreadPreview = {
  target: RedditTarget;
  subreddit: string;
  post: {
    title: string;
    author: string;
    body: string;
    score: number;
  };
  /** Présent uniquement quand on répond à un commentaire précis. */
  comment?: {
    author: string;
    body: string;
    score: number;
  };
};

type Listing = {
  data?: { children?: Array<{ kind?: string; data?: Record<string, unknown> }> };
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * Parcourt récursivement l'arbre de commentaires pour retrouver celui dont
 * l'id base36 correspond, puis renvoie auteur/corps/score.
 */
function findComment(
  children: Array<{ kind?: string; data?: Record<string, unknown> }> | undefined,
  commentId: string,
): { author: string; body: string; score: number } | undefined {
  if (!children) return undefined;

  for (const child of children) {
    if (child.kind !== "t1" || !child.data) continue;
    const data = child.data;

    if (asString(data.id) === commentId) {
      return {
        author: asString(data.author, "[inconnu]"),
        body: asString(data.body),
        score: asNumber(data.score),
      };
    }

    const replies = data.replies;
    if (replies && typeof replies === "object") {
      const nested = findComment(
        (replies as Listing).data?.children,
        commentId,
      );
      if (nested) return nested;
    }
  }

  return undefined;
}

/**
 * Récupère le contexte du fil ciblé via l'endpoint .json de Reddit, en passant
 * par le contexte navigateur authentifié (partage les cookies de session).
 * Reddit bloque (403) les requêtes .json non authentifiées, d'où l'usage de la
 * session connectée plutôt qu'un fetch anonyme.
 */
export async function fetchPreview(
  context: BrowserContext,
  rawUrl: string,
): Promise<ThreadPreview> {
  const target = parseRedditUrl(rawUrl);

  const response = await context.request.get(target.jsonUrl, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    timeout: 30000,
  });

  if (!response.ok()) {
    throw new Error(
      `Reddit a renvoyé ${response.status()} lors du chargement de l'aperçu ` +
        `(session non connectée, rate-limit ou fil privé ?).`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || payload.length < 1) {
    throw new Error("Réponse .json inattendue de Reddit.");
  }

  const postListing = payload[0] as Listing;
  const postData = postListing.data?.children?.[0]?.data;
  if (!postData) {
    throw new Error("Impossible de lire les données du post.");
  }

  const preview: ThreadPreview = {
    target,
    subreddit: asString(postData.subreddit_name_prefixed, asString(postData.subreddit)),
    post: {
      title: asString(postData.title, "[sans titre]"),
      author: asString(postData.author, "[inconnu]"),
      body: asString(postData.selftext),
      score: asNumber(postData.score),
    },
  };

  if (target.type === "comment" && target.commentId) {
    const commentListing = payload[1] as Listing | undefined;
    const comment = findComment(commentListing?.data?.children, target.commentId);
    if (comment) {
      preview.comment = comment;
    }
  }

  return preview;
}

export type ThreadContext = {
  title: string;
  subreddit: string;
  body: string;
  comments: Array<{ author: string; body: string; score: number }>;
};

/**
 * Contexte complet d'un thread pour la génération de réponse : titre, corps, et
 * top commentaires (pour capter le ton / l'humour). Via .json authentifié.
 */
export async function fetchThreadContext(
  context: BrowserContext,
  rawUrl: string,
  maxComments = 8,
): Promise<ThreadContext> {
  const target = parseRedditUrl(rawUrl);
  const response = await context.request.get(target.jsonUrl, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    timeout: 30000,
  });
  if (!response.ok()) throw new Error(`Reddit a renvoyé ${response.status()} (session ? rate-limit ?).`);

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || payload.length < 1) throw new Error("Réponse .json inattendue.");

  const postData = (payload[0] as Listing).data?.children?.[0]?.data ?? {};
  const commentChildren = (payload[1] as Listing | undefined)?.data?.children ?? [];

  const comments: ThreadContext["comments"] = [];
  for (const child of commentChildren) {
    if (child.kind !== "t1" || !child.data) continue;
    const body = asString(child.data.body);
    if (!body || body === "[deleted]" || body === "[removed]") continue;
    comments.push({
      author: asString(child.data.author, "[?]"),
      body: body.slice(0, 600),
      score: asNumber(child.data.score),
    });
    if (comments.length >= maxComments) break;
  }

  return {
    title: asString(postData.title, "[sans titre]"),
    subreddit: asString(postData.subreddit, ""),
    body: asString(postData.selftext).slice(0, 2000),
    comments,
  };
}
