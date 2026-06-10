import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { mkdir } from "node:fs/promises";
import { BROWSER_USER_AGENT, PROFILE_DIR } from "../config.js";
import { localAccount } from "./accounts.js";
import type { Account } from "../schemas.js";

const COMMON_OPTIONS = {
  viewport: { width: 1280, height: 900 },
  userAgent: BROWSER_USER_AGENT,
  locale: "fr-FR",
} as const;

/** Construit l'option proxy Playwright pour un compte donné, si défini. */
function proxyOption(account: Account) {
  if (!account.proxy?.server) return {};
  return {
    proxy: {
      server: account.proxy.server,
      ...(account.proxy.username ? { username: account.proxy.username } : {}),
      ...(account.proxy.password ? { password: account.proxy.password } : {}),
    },
  };
}

/**
 * Lance un contexte Chromium pour un compte :
 * - compte avec session injectée (sessionB64) → navigateur jetable + storageState
 *   (mode serveur, sans interface graphique) ;
 * - compte local (sessionB64 vide) → profil persistant sur disque (login manuel).
 * Chaque compte utilise son propre proxy résidentiel.
 */
export async function launchContextForAccount(
  account: Account,
  headless: boolean,
): Promise<BrowserContext> {
  const proxy = proxyOption(account);

  // Compte local : profil persistant sur disque (login manuel via fenêtre).
  if (account.local) {
    await mkdir(PROFILE_DIR, { recursive: true });
    return chromium.launchPersistentContext(PROFILE_DIR, {
      headless,
      ...COMMON_OPTIONS,
      ...proxy,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }

  // Compte géré : navigateur jetable. storageState si fourni (legacy), sinon
  // contexte vierge — la connexion se fera par identifiants (login-flow).
  const browser = await chromium.launch({
    headless: true,
    ...proxy,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const storageState = account.sessionB64
    ? (JSON.parse(
        Buffer.from(account.sessionB64, "base64").toString("utf8"),
      ) as BrowserContextOptions["storageState"])
    : undefined;

  return browser.newContext({ ...COMMON_OPTIONS, ...(storageState ? { storageState } : {}) });
}

/** Lance le contexte du compte local (profil persistant). Utilisé par le login manuel. */
export async function launchContext(headless: boolean): Promise<BrowserContext> {
  return launchContextForAccount(localAccount(), headless);
}

/**
 * Récupère une page existante du contexte ou en crée une.
 */
export async function getPage(context: BrowserContext): Promise<Page> {
  const existing = context.pages()[0];
  return existing ?? (await context.newPage());
}

/**
 * Renvoie l'IP de sortie réellement vue par les sites (via une navigation de
 * page, donc à travers le proxy s'il est configuré). Permet de vérifier que le
 * proxy résidentiel fonctionne et quelle IP/zone Reddit voit.
 */
export async function getEgressIp(context: BrowserContext): Promise<string | null> {
  const page = await context.newPage();
  try {
    const response = await page.goto("https://api.ipify.org?format=json", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    if (!response) return null;
    const body = (await response.json().catch(() => null)) as { ip?: string } | null;
    return typeof body?.ip === "string" ? body.ip : null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Vérifie si la session est connectée à Reddit en interrogeant /api/me.json
 * via le contexte de requêtes (partage les cookies, sans déranger les pages
 * ouvertes — important pendant le login manuel).
 * Renvoie le nom d'utilisateur connecté, ou null si déconnecté.
 */
export async function getLoggedInUser(context: BrowserContext): Promise<string | null> {
  try {
    const response = await context.request.get("https://www.reddit.com/api/me.json", {
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
      timeout: 30000,
    });
    if (!response.ok()) return null;

    const body = (await response.json().catch(() => null)) as
      | { data?: { name?: string } }
      | null;
    const name = body?.data?.name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
