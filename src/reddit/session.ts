import { rm } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { HEADLESS, LOCAL_MODE, PROFILE_DIR } from "../config.js";
import { getLoggedInUser, getPage, launchContext, launchContextForAccount } from "./browser.js";
import { defaultAccountId, getAccount } from "./accounts.js";
import { performLogin, type LoginResult } from "./login-flow.js";
import { logLine } from "../log.js";

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

/** Relance un contexte neuf pour le compte → nouvelle IP proxy (rotation). */
async function relaunchContext(accountId: string): Promise<BrowserContext> {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Compte inconnu : ${accountId}`);
  await closeContext();
  context = await launchContextForAccount(account, HEADLESS);
  currentAccountId = accountId;
  return context;
}

// Anti-tempête / sécurité compte : un cycle de login auto au plus toutes les
// 10 min par compte (évite de verrouiller le compte). Les retours « IP bloquée »
// ne soumettent PAS d'identifiants : on peut donc faire tourner l'IP sans risque.
const lastLoginAttempt = new Map<string, number>();
const LOGIN_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 4;

/** Réinitialise le cooldown de login (reconnexion forcée depuis l'UI). */
export function resetLoginCooldown(accountId?: string): void {
  if (accountId) lastLoginAttempt.delete(accountId);
  else lastLoginAttempt.clear();
}

/**
 * Vérifie la connexion ; si déconnecté et que le compte a des identifiants,
 * relance un login automatique. Réessaie avec une IP fraîche tant que l'échec
 * est lié à l'IP (blocage « network security ») — sans re-soumettre le mot de
 * passe. Opère sur le contexte courant du module (qu'il peut relancer).
 */
async function loginIfNeeded(accountId: string): Promise<LoginResult> {
  if (!context) throw new Error("Contexte non initialisé");

  const existing = await getLoggedInUser(context).catch(() => null);
  if (existing) return { ok: true, user: existing };

  const account = getAccount(accountId);
  if (!account?.credentials) {
    return { ok: false, error: "Compte déconnecté (pas d'identifiants pour reconnexion auto)." };
  }

  const last = lastLoginAttempt.get(accountId) ?? 0;
  if (Date.now() - last < LOGIN_COOLDOWN_MS) {
    return { ok: false, error: "Reconnexion récente échouée — nouvelle tentative différée." };
  }
  lastLoginAttempt.set(accountId, Date.now());

  let result: LoginResult = { ok: false, error: "Échec de connexion." };
  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
    logLine(`Reconnexion « ${account.label} » — tentative ${attempt}/${MAX_LOGIN_ATTEMPTS}`);
    result = await performLogin(context, account.credentials, Date.now() / 1000);
    if (result.ok || !result.retryable) return result; // succès, ou échec dur (CAPTCHA/identifiants)
    if (attempt < MAX_LOGIN_ATTEMPTS) {
      logLine("Rotation : nouvelle IP résidentielle…");
      await relaunchContext(accountId); // IP bloquée → autre IP
    }
  }
  return result;
}

/**
 * Exécute `fn` avec le contexte du compte, en s'assurant d'abord qu'il est
 * connecté (reconnexion auto par identifiants si besoin). Tout est sérialisé.
 */
export function withLoggedInAccount<T>(
  accountId: string | undefined,
  fn: (context: BrowserContext, login: LoginResult) => Promise<T>,
): Promise<T> {
  return runExclusive(async () => {
    const id = accountId ?? defaultAccountId();
    await ensureAccount(id);
    const login = await loginIfNeeded(id);
    if (!context) throw new Error("Contexte non initialisé");
    return fn(context, login);
  });
}

// --- État de connexion en cache (statut non bloquant) -----------------------
export type CachedState = {
  loggedIn: boolean;
  user: string | null;
  error?: string;
  pending: boolean;
  checkedAt: number;
};

const stateById = new Map<string, CachedState>();
const refreshing = new Set<string>();

/** État de connexion en cache (réponse instantanée pour /api/status). */
export function getCachedState(accountId: string): CachedState {
  return (
    stateById.get(accountId) ?? { loggedIn: false, user: null, pending: true, checkedAt: 0 }
  );
}

/**
 * Lance en arrière-plan (sans bloquer) une vérification + reconnexion auto du
 * compte, et met à jour l'état en cache. Dédupliqué par compte.
 */
export function refreshLogin(accountId: string | undefined): void {
  const id = accountId ?? defaultAccountId();
  if (refreshing.has(id)) return;
  refreshing.add(id);

  const prev = stateById.get(id);
  stateById.set(id, {
    loggedIn: prev?.loggedIn ?? false,
    user: prev?.user ?? null,
    pending: true,
    checkedAt: prev?.checkedAt ?? 0,
  });

  void withLoggedInAccount(id, async (_context, login) => login)
    .then((login) => {
      stateById.set(id, {
        loggedIn: login.ok,
        user: login.user ?? null,
        pending: false,
        checkedAt: Date.now(),
        ...(login.ok ? {} : { error: login.error }),
      });
    })
    .catch((error) => {
      stateById.set(id, {
        loggedIn: false,
        user: null,
        pending: false,
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => refreshing.delete(id));
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

/**
 * Connexion MANUELLE : ouvre une fenêtre (headed) sur la page de login Reddit,
 * pour que l'humain saisisse les identifiants et résolve un éventuel CAPTCHA.
 * Ne fonctionne que si l'outil tourne avec un écran (local) — pas en mode
 * serveur headless. La session obtenue devient le contexte actif du compte.
 */
export async function startManualLogin(accountId: string): Promise<void> {
  const id = accountId || defaultAccountId();
  const account = getAccount(id);
  if (!account) throw new Error(`Compte inconnu : ${id}`);

  await runExclusive(async () => {
    switching = true;
    await closeContext();
    try {
      context = await launchContextForAccount(account, false); // fenêtre visible
      currentAccountId = id;
      const page = await getPage(context);
      await page.bringToFront().catch(() => undefined);
      await page
        .goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded" })
        .catch(() => undefined);
      await page.bringToFront().catch(() => undefined);
      logLine(`Connexion manuelle « ${account.label} » : fenêtre ouverte, connecte-toi.`);
    } catch (error) {
      switching = false;
      throw new Error(
        "Impossible d'ouvrir une fenêtre — l'outil tourne en mode serveur (headless). " +
          "La connexion manuelle nécessite de lancer l'outil en local (npm run dev sur ta machine).",
      );
    }
  });

  void waitForManualLogin(id);
}

async function waitForManualLogin(accountId: string): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const current = context;
      if (!current) break;
      const user = await getLoggedInUser(current).catch(() => null);
      if (user) {
        logLine(`Connexion manuelle réussie : u/${user} (compte ${accountId}).`);
        break;
      }
    }
  } finally {
    switching = false;
  }
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
