import {
  ACCOUNTS_B64,
  HAS_ENV_CREDENTIALS,
  PROXY_ENABLED,
  PROXY_PASSWORD,
  PROXY_SERVER,
  PROXY_USERNAME,
  REDDIT_PASSWORD,
  REDDIT_SESSION_B64,
  REDDIT_TOTP_SECRET,
  REDDIT_USERNAME,
  REMOTE_MODE,
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

let cached: Account[] | null = null;

/**
 * Liste des comptes selon le mode :
 * - ACCOUNTS_B64 défini → multi-comptes (un par marché, proxy par compte) ;
 * - sinon REDDIT_SESSION_B64 défini → compte unique injecté + proxy d'env ;
 * - sinon → compte local (profil persistant).
 */
export function getAccounts(): Account[] {
  if (cached) return cached;

  if (ACCOUNTS_B64) {
    const json = Buffer.from(ACCOUNTS_B64, "base64").toString("utf8");
    const parsed = accountsSchema.safeParse(JSON.parse(json));
    if (!parsed.success || parsed.data.length === 0) {
      throw new Error("ACCOUNTS_B64 invalide : " + (parsed.success ? "liste vide" : parsed.error.message));
    }
    cached = parsed.data;
  } else if (REMOTE_MODE || HAS_ENV_CREDENTIALS) {
    const proxy = envProxy();
    const credentials = envCredentials();
    cached = [
      {
        id: "default",
        label: "Compte par défaut",
        ...(REDDIT_SESSION_B64 ? { sessionB64: REDDIT_SESSION_B64 } : {}),
        ...(credentials ? { credentials } : {}),
        ...(proxy ? { proxy } : {}),
      },
    ];
  } else {
    cached = [localAccount()];
  }

  return cached;
}

/** Identifiant du compte par défaut (le premier de la liste). */
export function defaultAccountId(): string {
  return getAccounts()[0]?.id ?? "local";
}

/** Récupère un compte par id, ou undefined. */
export function getAccount(id: string): Account | undefined {
  return getAccounts().find((account) => account.id === id);
}

/** Vue publique des comptes (sans secrets) pour l'UI. */
export function publicAccounts(): Array<{ id: string; label: string }> {
  return getAccounts().map((account) => ({ id: account.id, label: account.label }));
}
