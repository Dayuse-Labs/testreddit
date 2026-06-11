import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  ACCOUNTS_B64,
  DATA_DIR,
  HAS_ENV_CREDENTIALS,
  IP_ROTATION_FILE,
  PROXY_BASE_USERNAME,
  PROXY_ENABLED,
  PROXY_PASSWORD,
  PROXY_SERVER,
  PROXY_USERNAME,
  REDDIT_PASSWORD,
  REDDIT_SESSION_B64,
  REDDIT_TOTP_SECRET,
  REDDIT_USERNAME,
  REMOTE_MODE,
  RUNTIME_ACCOUNTS_FILE,
} from "../config.js";
import {
  accountsSchema,
  type Account,
  type Credentials,
  type ProxyConfig,
} from "../schemas.js";

function envProxy(): ProxyConfig | undefined {
  if (!PROXY_ENABLED) return undefined;
  return {
    server: PROXY_SERVER,
    ...(PROXY_USERNAME ? { username: PROXY_USERNAME } : {}),
    ...(PROXY_PASSWORD ? { password: PROXY_PASSWORD } : {}),
  };
}

/** Durée de vie d'une session sticky Decodo (minutes) — l'IP reste stable. */
const PROXY_SESSION_DURATION = 1440;

/** true si la base Decodo (serveur + username de base) est configurée (env). */
export function proxyBaseConfigured(): boolean {
  return PROXY_SERVER.length > 0 && PROXY_BASE_USERNAME.length > 0;
}

// --- Rotation d'IP par compte ------------------------------------------------
// Le jeton de session sticky est dérivé de l'id du compte (→ IP stable). Si l'IP
// du pool Decodo est flaggée par Reddit, on « tourne » : on incrémente un
// compteur persistant, ce qui change le jeton → nouvelle IP résidentielle.

function readRotations(): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(IP_ROTATION_FILE, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Numéro de rotation d'IP courant du compte (0 = IP initiale). */
export function getRotation(accountId: string): number {
  const value = readRotations()[accountId];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Incrémente la rotation → nouvelle IP au prochain lancement. Renvoie le n° courant. */
export function rotateAccountIp(accountId: string): number {
  const rotations = readRotations();
  const next = getRotation(accountId) + 1;
  rotations[accountId] = next;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(IP_ROTATION_FILE, JSON.stringify(rotations, null, 2), "utf8");
  return next;
}

/**
 * Jeton de session sticky alphanumérique, unique par compte (→ IP dédiée). Suffixé
 * par le n° de rotation : changer de rotation = changer d'IP résidentielle.
 */
function sessionToken(accountId: string): string {
  const base = accountId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 28) || "acct";
  const rotation = getRotation(accountId);
  return rotation > 0 ? `${base}r${rotation}` : base;
}

/**
 * Pose le jeton `-session-XXX` (rotation incluse) dans un username proxy collé à
 * la main. Si rotation > 0, on REMPLACE un jeton existant (pour changer d'IP) ;
 * sinon on l'ajoute seulement s'il est absent (on respecte le jeton de l'utilisateur).
 */
function ensureStickySession(username: string, accountId: string): string {
  const token = sessionToken(accountId);
  const hasToken = /-session-[^-]+/.test(username);
  if (hasToken) {
    return getRotation(accountId) > 0 ? username.replace(/-session-[^-]+/, `-session-${token}`) : username;
  }
  if (/-sessionduration-/.test(username)) {
    return username.replace(/-sessionduration-/, `-session-${token}-sessionduration-`);
  }
  return `${username}-session-${token}`;
}

/**
 * Résout le proxy effectif d'un compte → IP résidentielle dédiée et STABLE :
 * - proxy explicite (avancé) : utilisé tel quel (jeton sticky garanti) ;
 * - sinon proxyCountry + base Decodo (env) : on génère
 *   `<base>-country-<cc>-session-<id>-sessionduration-1440` — chaque compte a
 *   ainsi son propre jeton de session, donc sa propre IP résidentielle.
 */
export function resolveAccountProxy(account: Account): ProxyConfig | undefined {
  if (account.proxy?.server) {
    const username = account.proxy.username
      ? ensureStickySession(account.proxy.username, account.id)
      : undefined;
    return {
      server: account.proxy.server,
      ...(username ? { username } : {}),
      ...(account.proxy.password ? { password: account.proxy.password } : {}),
    };
  }
  if (account.proxyCountry && proxyBaseConfigured()) {
    const username =
      `${PROXY_BASE_USERNAME}-country-${account.proxyCountry}` +
      `-session-${sessionToken(account.id)}-sessionduration-${PROXY_SESSION_DURATION}`;
    return {
      server: PROXY_SERVER,
      username,
      ...(PROXY_PASSWORD ? { password: PROXY_PASSWORD } : {}),
    };
  }
  return undefined;
}

function envCredentials(): Credentials | undefined {
  if (!HAS_ENV_CREDENTIALS) return undefined;
  return {
    username: REDDIT_USERNAME,
    password: REDDIT_PASSWORD,
    ...(REDDIT_TOTP_SECRET ? { totpSecret: REDDIT_TOTP_SECRET } : {}),
  };
}

/** Compte local (profil persistant + login manuel). */
export function localAccount(): Account {
  const proxy = envProxy();
  return { id: "local", label: "Compte local", local: true, ...(proxy ? { proxy } : {}) };
}

export function slugifyId(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "compte"
  );
}

/** Comptes issus de l'environnement (ACCOUNTS_B64 / session / local). Non supprimables. */
function envAccounts(): Account[] {
  if (ACCOUNTS_B64) {
    const parsed = accountsSchema.safeParse(JSON.parse(Buffer.from(ACCOUNTS_B64, "base64").toString("utf8")));
    if (!parsed.success || parsed.data.length === 0) {
      throw new Error("ACCOUNTS_B64 invalide : " + (parsed.success ? "liste vide" : parsed.error.message));
    }
    return parsed.data;
  }
  if (REMOTE_MODE || HAS_ENV_CREDENTIALS) {
    const proxy = envProxy();
    const credentials = envCredentials();
    return [
      {
        id: "default",
        label: "Compte par défaut",
        ...(REDDIT_SESSION_B64 ? { sessionB64: REDDIT_SESSION_B64 } : {}),
        ...(credentials ? { credentials } : {}),
        ...(proxy ? { proxy } : {}),
      },
    ];
  }
  return [localAccount()];
}

/** Comptes ajoutés via l'interface (fichier modifiable). Supprimables. */
function fileAccounts(): Account[] {
  try {
    const parsed = accountsSchema.safeParse(JSON.parse(readFileSync(RUNTIME_ACCOUNTS_FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeFileAccounts(accounts: Account[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(RUNTIME_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");
  cached = null;
}

let cached: Account[] | null = null;

/** Comptes (env + fichier), dédupliqués par id (le fichier prime). */
export function getAccounts(): Account[] {
  if (cached) return cached;
  const byId = new Map<string, Account>();
  for (const a of envAccounts()) byId.set(a.id, a);
  for (const a of fileAccounts()) byId.set(a.id, a);
  cached = [...byId.values()];
  return cached;
}

export function defaultAccountId(): string {
  return getAccounts()[0]?.id ?? "local";
}

export function getAccount(id: string): Account | undefined {
  return getAccounts().find((account) => account.id === id);
}

/** Ajoute (ou remplace) un compte côté fichier. */
export function addAccount(account: Account): Account {
  const others = fileAccounts().filter((a) => a.id !== account.id);
  writeFileAccounts([...others, account]);
  return account;
}

/** Supprime un compte ajouté via l'UI (pas les comptes d'environnement). */
export function removeAccount(id: string): boolean {
  const items = fileAccounts();
  const next = items.filter((a) => a.id !== id);
  if (next.length === items.length) return false;
  writeFileAccounts(next);
  return true;
}

/** Vue publique des comptes (sans secrets) pour l'UI. */
export function publicAccounts(): Array<{
  id: string;
  label: string;
  redditUsername?: string;
  hasProxy: boolean;
  proxyCountry?: string;
  ipRotation: number;
  hasCredentials: boolean;
  removable: boolean;
}> {
  const fileIds = new Set(fileAccounts().map((a) => a.id));
  return getAccounts().map((account) => ({
    id: account.id,
    label: account.label,
    ...(account.redditUsername ? { redditUsername: account.redditUsername } : {}),
    hasProxy: Boolean(resolveAccountProxy(account)?.server),
    ...(account.proxyCountry ? { proxyCountry: account.proxyCountry } : {}),
    ipRotation: getRotation(account.id),
    hasCredentials: Boolean(account.credentials),
    removable: fileIds.has(account.id),
  }));
}
