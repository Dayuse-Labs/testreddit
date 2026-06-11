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
