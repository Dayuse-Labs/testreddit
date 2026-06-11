import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { BrowserContextOptions } from "playwright";
import { DATA_DIR, SESSIONS_FILE } from "../config.js";

export type StorageState = NonNullable<BrowserContextOptions["storageState"]>;
type Store = Record<string, StorageState>;

function read(): Store {
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

/** Session (storageState Playwright) injectée pour un compte, ou undefined. */
export function getInjectedSession(accountId: string): StorageState | undefined {
  return read()[accountId];
}

/** Enregistre la session injectée d'un compte (cookies du navigateur de l'utilisateur). */
export function setInjectedSession(accountId: string, state: StorageState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const store = read();
  store[accountId] = state;
  writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2), "utf8");
}
