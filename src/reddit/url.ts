export type RedditTarget = {
  /** "post" si l'URL vise le post lui-même, "comment" si elle vise un commentaire précis. */
  type: "post" | "comment";
  /** Id base36 du post (sans préfixe t3_). */
  postId: string;
  /** Id base36 du commentaire ciblé (sans préfixe t1_), présent uniquement si type === "comment". */
  commentId?: string;
  /** Permalien canonique sur www.reddit.com. */
  canonicalUrl: string;
  /** Permalien équivalent sur old.reddit.com (utilisé pour la publication). */
  oldUrl: string;
  /** URL .json correspondante (utilisée pour l'aperçu en lecture seule). */
  jsonUrl: string;
};

/**
 * Analyse une URL Reddit et détermine si elle vise un post ou un commentaire.
 *
 * Format d'un permalien :
 *   /r/{sub}/comments/{postId}/{slug}/                -> post
 *   /r/{sub}/comments/{postId}/{slug}/{commentId}/    -> commentaire
 *
 * Le slug peut être absent (Reddit l'accepte) ; on se base sur la position de
 * "comments" dans le chemin pour repérer postId puis l'éventuel commentId.
 */
export function parseRedditUrl(rawUrl: string): RedditTarget {
  const parsed = new URL(rawUrl.trim());

  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const commentsIndex = segments.indexOf("comments");

  if (commentsIndex === -1 || segments.length <= commentsIndex + 1) {
    throw new Error("URL Reddit non reconnue : segment /comments/{id} introuvable.");
  }

  const postId = segments[commentsIndex + 1] as string;
  // segments[commentsIndex + 2] = slug du titre (optionnel)
  // segments[commentsIndex + 3] = id du commentaire (optionnel)
  const commentId = segments[commentsIndex + 3];

  // Reconstruit un chemin propre jusqu'au commentaire ciblé (ou au post).
  const basePath = "/" + segments.slice(0, commentsIndex + 1).join("/");
  const slug = segments[commentsIndex + 2] ?? "_";
  const pathToPost = `${basePath}/${postId}/${slug}/`;
  const pathToTarget = commentId ? `${pathToPost}${commentId}/` : pathToPost;

  const canonicalUrl = `https://www.reddit.com${pathToTarget}`;
  const oldUrl = `https://old.reddit.com${pathToTarget}`;

  // L'endpoint .json se construit sur le chemin du post ; le commentaire est
  // résolu côté preview.ts en parcourant l'arbre renvoyé.
  const jsonUrl = `https://www.reddit.com${pathToPost.replace(/\/$/, "")}.json?raw_json=1&limit=50`;

  return {
    type: commentId ? "comment" : "post",
    postId,
    ...(commentId ? { commentId } : {}),
    canonicalUrl,
    oldUrl,
    jsonUrl,
  };
}
