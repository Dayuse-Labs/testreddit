import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { SCREENSHOTS_DIR } from "../config.js";
import { getLoggedInUser, getPage } from "./browser.js";
import { parseRedditUrl, type RedditTarget } from "./url.js";

export type PostResult = {
  success: boolean;
  target: RedditTarget;
  loggedInUser: string | null;
  /** Nom de fichier de la capture d'écran (servie via /screenshots/:file). */
  screenshotFile?: string;
  error?: string;
};

/** Génère un nom de fichier de capture sûr à partir d'un timestamp fourni. */
function screenshotName(target: RedditTarget, isoTimestamp: string): string {
  const stamp = isoTimestamp.replace(/[:.]/g, "-");
  const id = target.commentId ?? target.postId;
  return `reply-${id}-${stamp}.png`;
}

/**
 * Publie une réponse sur old.reddit.com (DOM stable, peu de JS dynamique).
 * - Réponse à un post : formulaire de commentaire en tête de .commentarea.
 * - Réponse à un commentaire : clic sur "reply" du commentaire ciblé puis envoi.
 *
 * `isoTimestamp` est injecté par l'appelant (le serveur) pour nommer la capture.
 */
export async function postReply(
  context: BrowserContext,
  rawUrl: string,
  text: string,
  isoTimestamp: string,
): Promise<PostResult> {
  const target = parseRedditUrl(rawUrl);
  const loggedInUser = await getLoggedInUser(context);

  if (!loggedInUser) {
    return {
      success: false,
      target,
      loggedInUser: null,
      error: "Session Reddit non connectée. Lance `npm run login` puis reconnecte-toi.",
    };
  }

  const page = await getPage(context);
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  try {
    await page.goto(target.oldUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    if (target.type === "comment" && target.commentId) {
      await replyToComment(page, target.commentId, text);
    } else {
      await replyToPost(page, text);
    }

    // Laisse l'insertion AJAX du commentaire se terminer.
    await page.waitForTimeout(2500);

    const screenshotFile = screenshotName(target, isoTimestamp);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, screenshotFile),
      fullPage: false,
    });

    return { success: true, target, loggedInUser, screenshotFile };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Capture d'écran d'échec pour diagnostic.
    let screenshotFile: string | undefined;
    try {
      screenshotFile = `error-${screenshotName(target, isoTimestamp)}`;
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, screenshotFile) });
    } catch {
      screenshotFile = undefined;
    }

    return {
      success: false,
      target,
      loggedInUser,
      error: message,
      ...(screenshotFile ? { screenshotFile } : {}),
    };
  }
}

/** Remplit et soumet le formulaire de commentaire de premier niveau du post. */
async function replyToPost(page: import("playwright").Page, text: string): Promise<void> {
  const form = page.locator(".commentarea > .usertext").first();
  const textarea = form.locator('textarea[name="text"]');

  await textarea.waitFor({ state: "visible", timeout: 20000 });
  await textarea.click();
  await textarea.fill(text);

  await form.locator('button[type="submit"]').first().click();
}

/** Localise le commentaire ciblé, ouvre son formulaire de réponse et envoie. */
async function replyToComment(
  page: import("playwright").Page,
  commentId: string,
  text: string,
): Promise<void> {
  const comment = page.locator(`.thing[data-fullname="t1_${commentId}"]`).first();
  await comment.waitFor({ state: "attached", timeout: 20000 });
  await comment.scrollIntoViewIfNeeded();

  // Le lien "reply" se trouve dans la barre de boutons propre au commentaire.
  const replyLink = comment.locator(".entry").first().locator('ul.flat-list.buttons a', {
    hasText: /^reply$/i,
  });
  await replyLink.first().click();

  // Le formulaire de réponse est cloné dans le conteneur .child du commentaire.
  const textarea = comment.locator('.child textarea[name="text"]').first();
  await textarea.waitFor({ state: "visible", timeout: 15000 });
  await textarea.click();
  await textarea.fill(text);

  await comment.locator('.child button[type="submit"]').first().click();
}
