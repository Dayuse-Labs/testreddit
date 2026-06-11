import { addExtra } from "playwright-extra";
import { chromium as rebrowserChromium } from "rebrowser-playwright";
import { chromium as basePlaywright } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { BrowserContext, BrowserContextOptions, Page } from "playwright";
import { mkdir } from "node:fs/promises";

// Base = rebrowser-playwright : corrige la fuite CDP `Runtime.enable` que Reddit
// (Cloudflare/DataDome) utilisent pour détecter l'automatisation — c'est ce qui
// déclenchait le « An error occurred ». On lance le Chromium déjà installé par
// playwright (executablePath) + le plugin stealth par-dessus.
const chromium = addExtra(rebrowserChromium as unknown as Parameters<typeof addExtra>[0]);
chromium.use(StealthPlugin());

/** Chemin du Chromium installé par playwright (réutilisé par rebrowser). */
function chromiumPath(): string {
  return basePlaywright.executablePath();
}

import { BROWSER_USER_AGENT, PROFILE_DIR } from "../config.js";
import { localAccount } from "./accounts.js";
import type { Account } from "../schemas.js";

const COMMON_OPTIONS = {
  viewport: { width: 1280, height: 900 },
  userAgent: BROWSER_USER_AGENT,
  locale: "fr-FR",
} as const;

/**
 * Génère un jeton de session sticky NEUF à chaque appel. Évite la réutilisation
 * d'un jeton « coincé » côté Decodo (qui finit en 502 une fois son IP libérée).
 */
function freshSessionToken(): string {
  return "s" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

/**
 * Remplace (ou insère) le jeton `-session-XXX` du username proxy par un jeton
 * neuf, en conservant `-sessionduration-N`. Chaque contexte obtient ainsi une IP
 * résidentielle stable pour sa durée de vie, sans réutiliser un jeton périmé.
 */
function withFreshSession(username: string): string {
  const token = freshSessionToken();
  if (/-session-[^-]+/.test(username)) {
    return username.replace(/-session-[^-]+/, `-session-${token}`);
  }
  if (/-sessionduration-/.test(username)) {
    return username.replace(/-sessionduration-/, `-session-${token}-sessionduration-`);
  }
  return `${username}-session-${token}`;
}

/** Construit l'option proxy Playwright pour un compte donné, si défini. */
function proxyOption(account: Account) {
  if (!account.proxy?.server) return {};
  const username = account.proxy.username ? withFreshSession(account.proxy.username) : undefined;
  return {
    proxy: {
      server: account.proxy.server,
      ...(username ? { username } : {}),
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
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless,
      executablePath: chromiumPath(),
      ...COMMON_OPTIONS,
      ...proxy,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    return ctx;
  }

  // Compte géré : navigateur jetable. storageState si fourni (legacy), sinon
  // contexte vierge — la connexion se fera par identifiants (login-flow).
  // headless suit la config (HEADLESS=false + xvfb sur Railway = moins détectable).
  const browser = await chromium.launch({
    headless,
    executablePath: chromiumPath(),
    ...proxy,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const storageState = account.sessionB64
    ? (JSON.parse(
        Buffer.from(account.sessionB64, "base64").toString("utf8"),
      ) as BrowserContextOptions["storageState"])
    : undefined;

  const ctx = await browser.newContext({
    ...COMMON_OPTIONS,
    ...(storageState ? { storageState } : {}),
  });
  return ctx;
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
