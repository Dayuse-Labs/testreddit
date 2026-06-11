import type { BrowserContext } from "playwright";
import { BROWSER_USER_AGENT } from "../config.js";

export type RedditPost = {
  fullname: string; // t3_xxx
  title: string;
  subreddit: string;
  author: string;
  permalink: string; // https://old.reddit.com/...
  url: string; // url canonique www
  commentsCount: number;
  score: number;
  createdAtMs: number; // timestamp du post
  nsfw: boolean;
  promoted: boolean;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function attr(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`data-${name}="([^"]*)"`));
  return m ? decodeEntities(m[1] as string) : undefined;
}

/**
 * Parse une page de listing old.reddit. Chaque post est un <div class="thing …">
 * porteur d'attributs data-* (comments-count, score, timestamp, permalink…).
 */
export function parseListing(html: string): RedditPost[] {
  const posts: RedditPost[] = [];
  // Découpe sur chaque ouverture de div "thing".
  const chunks = html.split(/<div [^>]*class="[^"]*\bthing\b/);
  for (let i = 1; i < chunks.length; i++) {
    const head = '<div class="thing' + chunks[i];
    const fullname = attr(head, "fullname");
    if (!fullname || !fullname.startsWith("t3_")) continue; // posts seulement
    if (attr(head, "promoted") === "true") continue; // pas de pub

    const permalink = attr(head, "permalink") ?? "";
    const titleMatch = head.match(
      /<a[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([^<]+)<\/a>/,
    );
    const title = titleMatch ? decodeEntities(titleMatch[1] as string) : "";
    if (!title) continue;

    posts.push({
      fullname,
      title,
      subreddit: attr(head, "subreddit") ?? "",
      author: attr(head, "author") ?? "",
      permalink: permalink.startsWith("http")
        ? permalink
        : `https://www.reddit.com${permalink}`,
      url: attr(head, "url") ?? "",
      commentsCount: Number.parseInt(attr(head, "comments-count") ?? "0", 10) || 0,
      score: Number.parseInt(attr(head, "score") ?? "0", 10) || 0,
      createdAtMs: Number.parseInt(attr(head, "timestamp") ?? "0", 10) || 0,
      nsfw: attr(head, "nsfw") === "true",
      promoted: false,
    });
  }
  return posts;
}

type JsonChild = { kind?: string; data?: Record<string, unknown> };

function mapJsonPost(data: Record<string, unknown>): RedditPost {
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
  const num = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : 0);
  const permalink = str("permalink");
  return {
    fullname: `t3_${str("id")}`,
    title: str("title"),
    subreddit: str("subreddit"),
    author: str("author"),
    permalink: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
    url: str("url"),
    commentsCount: num("num_comments"),
    score: num("score"),
    createdAtMs: num("created_utc") * 1000, // .json = secondes
    nsfw: data.over_18 === true,
    promoted: false,
  };
}

/**
 * Recherche Reddit via search.json (authentifié via la session du contexte).
 * `sub` restreint à un subreddit ; sinon recherche site-wide.
 */
export async function searchReddit(
  context: BrowserContext,
  opts: { sub?: string; q: string; sort?: string; time?: string; limit?: number },
): Promise<RedditPost[]> {
  const base = opts.sub
    ? `https://www.reddit.com/r/${encodeURIComponent(opts.sub)}/search.json`
    : "https://www.reddit.com/search.json";
  const params = new URLSearchParams({
    q: opts.q,
    sort: opts.sort ?? "new",
    t: opts.time ?? "week",
    limit: String(opts.limit ?? 100),
    raw_json: "1",
  });
  if (opts.sub) params.set("restrict_sr", "on");

  const response = await context.request.get(`${base}?${params.toString()}`, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    timeout: 30000,
  });
  if (!response.ok()) throw new Error(`search.json HTTP ${response.status()}`);
  const json = (await response.json().catch(() => null)) as { data?: { children?: JsonChild[] } } | null;
  const children = json?.data?.children ?? [];
  return children.filter((c) => c.kind === "t3" && c.data).map((c) => mapJsonPost(c.data!));
}

/** Listing d'un subreddit via .json authentifié (alternative fiable à old.reddit HTML). */
export async function fetchListingJson(
  context: BrowserContext,
  subreddit: string,
  sort: "hot" | "new" = "hot",
  limit = 100,
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}&raw_json=1`;
  const response = await context.request.get(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    timeout: 30000,
  });
  if (!response.ok()) throw new Error(`r/${subreddit} HTTP ${response.status()}`);
  const json = (await response.json().catch(() => null)) as { data?: { children?: JsonChild[] } } | null;
  const children = json?.data?.children ?? [];
  return children.filter((c) => c.kind === "t3" && c.data).map((c) => mapJsonPost(c.data!));
}

/**
 * Récupère les posts récents d'un subreddit via old.reddit + le proxy du contexte
 * (lecture sans authentification, évite le 403 des .json).
 */
export async function fetchSubredditPosts(
  context: BrowserContext,
  subreddit: string,
  sort: "new" | "hot" = "new",
  limit = 50,
): Promise<RedditPost[]> {
  const url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}/?limit=${limit}`;
  const response = await context.request.get(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html" },
    timeout: 30000,
  });
  if (!response.ok()) {
    throw new Error(`Lecture r/${subreddit} : HTTP ${response.status()}`);
  }
  return parseListing(await response.text());
}

export type UserActivity = {
  kind: "comment" | "post";
  subreddit: string;
  title: string;
  body: string;
  permalink: string;
  score: number;
  createdAtMs: number;
};

/**
 * Activité d'un compte (commentaires ET posts) via /user/<u>.json authentifié.
 * Fiable via la session du contexte (contrairement au scraping old.reddit).
 */
export async function fetchUserActivity(
  context: BrowserContext,
  username: string,
): Promise<UserActivity[]> {
  const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/overview.json?limit=50&raw_json=1`;
  const response = await context.request.get(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    timeout: 30000,
  });
  if (!response.ok()) throw new Error(`u/${username} HTTP ${response.status()}`);
  const json = (await response.json().catch(() => null)) as { data?: { children?: JsonChild[] } } | null;
  const children = json?.data?.children ?? [];
  return children
    .filter((c) => (c.kind === "t1" || c.kind === "t3") && c.data)
    .map((c) => {
      const d = c.data as Record<string, unknown>;
      const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
      const num = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
      const permalink = str("permalink");
      return {
        kind: c.kind === "t3" ? ("post" as const) : ("comment" as const),
        subreddit: str("subreddit"),
        title: str("title") || str("link_title"),
        body: str("body").slice(0, 500),
        permalink: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
        score: num("score"),
        createdAtMs: num("created_utc") * 1000,
      };
    });
}

/** Récupère les commentaires récents publiés par un utilisateur (old.reddit). */
export async function fetchUserComments(
  context: BrowserContext,
  username: string,
): Promise<Array<{ subreddit: string; body: string; permalink: string; createdAtMs: number }>> {
  const url = `https://old.reddit.com/user/${encodeURIComponent(username)}/comments/?limit=50`;
  const response = await context.request.get(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html" },
    timeout: 30000,
  });
  if (!response.ok()) {
    throw new Error(`Lecture u/${username} : HTTP ${response.status()}`);
  }
  const html = await response.text();
  const out: Array<{ subreddit: string; body: string; permalink: string; createdAtMs: number }> = [];
  const chunks = html.split(/<div [^>]*class="[^"]*\bthing\b/);
  for (let i = 1; i < chunks.length; i++) {
    const head = '<div class="thing' + chunks[i];
    if (attr(head, "fullname")?.startsWith("t1_") !== true) continue;
    const bodyMatch = head.match(/<div class="md">([\s\S]*?)<\/div>\s*<\/div>/);
    const body = bodyMatch ? decodeEntities(bodyMatch[1]!.replace(/<[^>]+>/g, " ").trim()) : "";
    const permalink = attr(head, "permalink") ?? "";
    out.push({
      subreddit: attr(head, "subreddit") ?? "",
      body: body.slice(0, 500),
      permalink: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
      createdAtMs: Number.parseInt(attr(head, "timestamp") ?? "0", 10) || 0,
    });
  }
  return out;
}
