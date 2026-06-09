import { rm } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { HEADLESS, LOCAL_MODE, PROFILE_DIR } from "../config.js";
import { getLoggedInUser, getPage, launchContext, launchContextForAccount } from "./browser.js";
import { defaultAccountId, getAccount } from "./accounts.js";

/**
 * Gère un unique contexte Chromium actif, identifié par compte. Les opérations
 * déclarent le compte qu'elles visent ; le gestionnaire bascule le contexte si
 * nécessaire (cache de taille 1) et sérialise tout pour éviter les conflits sur
 * la page/le profil partagés.
 */

let context: BrowserContext | null = null;
let currentAccountId: string | null = null;
let switching = false;

let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function closeContext(): Promise<void> {
  if (!context) return;
  const closing = context;
  context = null;
  currentAccountId = null;
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

/** S'assure que le contexte actif correspond au compte demandé (bascule sinon). */
async function ensureAccount(accountId: string): Promise<BrowserContext> {
  const id = accountId || defaultAccountId();
  if (context && currentAccountId === id) return context;

  const account = getAccount(id);
  if (!account) throw new Error(`Compte inconnu : ${id}`);

  await closeContext();
  context = await launchContextForAccount(account, HEADLESS);
  currentAccountId = id;
  return context;
}

/** Exécute `fn` avec le contexte du compte demandé, de façon sérialisée. */
export function withAccount<T>(
  accountId: string | undefined,
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  return runExclusive(async () => {
    const ctx = await ensureAccount(accountId ?? defaultAccountId());
    return fn(ctx);
  });
}

export function getActiveAccountId(): string | null {
  return currentAccountId;
}

export function isSwitching(): boolean {
  return switching;
}

/**
 * Re-login local : efface le profil persistant et ouvre une fenêtre de
 * connexion. Disponible uniquement en mode local (un seul compte sur disque).
 */
export async function startAccountSwitch(): Promise<void> {
  if (!LOCAL_MODE) {
    throw new Error(
      "Re-login indisponible : les comptes sont gérés via la configuration (ACCOUNTS_B64). " +
        "Utilise le sélecteur de compte, ou régénère la configuration en local.",
    );
  }
  await runExclusive(async () => {
    switching = true;
    await closeContext();
    await rm(PROFILE_DIR, { recursive: true, force: true });
    context = await launchContext(false);
    currentAccountId = "local";
    const page = await getPage(context);
    await page
      .goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded" })
      .catch(() => undefined);
  });

  void waitForLoginThenRevert();
}

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
          currentAccountId = "local";
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
