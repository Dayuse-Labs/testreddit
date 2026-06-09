import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { mkdir } from "node:fs/promises";
import {
  BROWSER_USER_AGENT,
  PROFILE_DIR,
  PROXY_ENABLED,
  PROXY_PASSWORD,
  PROXY_SERVER,
  PROXY_USERNAME,
  REDDIT_SESSION_B64,
  REMOTE_MODE,
} from "../config.js";

/** Option proxy Playwright si un proxy résidentiel est configuré. */
const PROXY_OPTION = PROXY_ENABLED
  ? {
      proxy: {
        server: PROXY_SERVER,
        ...(PROXY_USERNAME ? { username: PROXY_USERNAME } : {}),
        ...(PROXY_PASSWORD ? { password: PROXY_PASSWORD } : {}),
      },
    }
  : {};

const COMMON_OPTIONS = {
  viewport: { width: 1280, height: 900 },
  userAgent: BROWSER_USER_AGENT,
  locale: "fr-FR",
} as const;

/**
 * Lance le contexte Chromium selon le mode :
 *
 * - Mode serveur (REMOTE_MODE) : la session est injectée via la variable
 *   d'environnement REDDIT_SESSION_B64 (base64 d'un storageState Playwright).
 *   Aucun profil sur disque, aucune interface graphique requise — adapté à
 *   Railway/VPS.
 * - Mode local : profil persistant partagé entre le login manuel (headed) et
 *   la publication (headless).
 */
export async function launchContext(headless: boolean): Promise<BrowserContext> {
  if (REMOTE_MODE) {
    const storageState = JSON.parse(
      Buffer.from(REDDIT_SESSION_B64, "base64").toString("utf8"),
    ) as BrowserContextOptions["storageState"];

    const browser = await chromium.launch({
      headless: true,
      ...PROXY_OPTION,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    return browser.newContext({ ...COMMON_OPTIONS, storageState });
  }

  await mkdir(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    ...COMMON_OPTIONS,
    ...PROXY_OPTION,
    args: ["--disable-blink-features=AutomationControlled"],
  });
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
