import { rm } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { HEADLESS, PROFILE_DIR, REMOTE_MODE } from "../config.js";
import { getLoggedInUser, getPage, launchContext } from "./browser.js";

/**
 * Gère l'unique contexte Chromium partagé par le serveur (Chromium verrouille
 * le profil persistant : un seul à la fois). Centralise aussi le changement de
 * compte et sérialise toutes les opérations sensibles (publication, swap).
 */

let context: BrowserContext | null = null;
let switching = false;

/** Sérialise publications et changements de contexte (page/profil partagés). */
let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Récupère (ou lance paresseusement) le contexte courant. */
export async function getContext(): Promise<BrowserContext> {
  if (!context) {
    context = await launchContext(HEADLESS);
  }
  return context;
}

/** Vrai pendant qu'un changement de compte est en cours. */
export function isSwitching(): boolean {
  return switching;
}

async function closeContext(): Promise<void> {
  if (!context) return;
  const closing = context;
  context = null;
  // En mode serveur, le contexte n'est pas persistant : il faut aussi fermer
  // le navigateur sous-jacent.
  const browser = closing.browser();
  try {
    await closing.close();
  } catch {
    // ignore
  }
  if (browser) {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Démarre un changement de compte :
 * 1. ferme le contexte courant et vide le profil (déconnexion totale) ;
 * 2. ouvre une fenêtre visible sur la page de login Reddit.
 * La détection de connexion puis le retour en headless se font en arrière-plan.
 * Renvoie dès que la fenêtre est ouverte.
 */
export async function startAccountSwitch(): Promise<void> {
  if (REMOTE_MODE) {
    throw new Error(
      "Changement de compte indisponible en mode serveur. Régénère la session " +
        "en local (npm run login) et mets à jour la variable REDDIT_SESSION_B64.",
    );
  }
  await runExclusive(async () => {
    switching = true;
    await closeContext();
    await rm(PROFILE_DIR, { recursive: true, force: true });
    context = await launchContext(false); // fenêtre visible pour le login
    const page = await getPage(context);
    await page
      .goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded" })
      .catch(() => undefined);
  });

  void waitForLoginThenRevert();
}

/**
 * Sonde la connexion sur le contexte visible ; une fois connecté (ou délai
 * dépassé), referme la fenêtre et relance en mode normal (headless par défaut).
 */
async function waitForLoginThenRevert(): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const current = context;
      if (!current) break;
      const user = await getLoggedInUser(current).catch(() => null);
      if (user) {
        await runExclusive(async () => {
          await closeContext();
          context = await launchContext(HEADLESS);
        });
        break;
      }
    }
  } finally {
    switching = false;
  }
}

/** Ferme proprement le contexte (arrêt du serveur). */
export async function disposeSession(): Promise<void> {
  await closeContext();
}
