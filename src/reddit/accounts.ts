import {
  ACCOUNTS_B64,
  PROXY_ENABLED,
  PROXY_PASSWORD,
  PROXY_SERVER,
  PROXY_USERNAME,
  REDDIT_SESSION_B64,
  REMOTE_MODE,
} from "../config.js";
import { accountsSchema, type Account, type ProxyConfig } from "../schemas.js";

function envProxy(): ProxyConfig | undefined {
  if (!PROXY_ENABLED) return undefined;
  return {
    server: PROXY_SERVER,
    ...(PROXY_USERNAME ? { username: PROXY_USERNAME } : {}),
    ...(PROXY_PASSWORD ? { password: PROXY_PASSWORD } : {}),
  };
}

/** Compte local (profil persistant + proxy d'environnement). sessionB64 vide = profil sur disque. */
export function localAccount(): Account {
  const proxy = envProxy();
  return { id: "local", label: "Compte local", sessionB64: "", ...(proxy ? { proxy } : {}) };
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
  } else if (REMOTE_MODE) {
    const proxy = envProxy();
    cached = [
      {
        id: "default",
        label: "Compte par défaut",
        sessionB64: REDDIT_SESSION_B64,
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
