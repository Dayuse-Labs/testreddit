import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import type { Recommendation } from "./recommend.js";

const FILE = path.join(DATA_DIR, "reco-cache.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 1 jour

export type CacheEntry = { generatedAt: string; items: Recommendation[] };
type Cache = Record<string, CacheEntry>;

async function readCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Cache;
  } catch {
    return {};
  }
}

async function writeCache(cache: Cache): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, "reco-cache.tmp.json");
  await writeFile(tmp, JSON.stringify(cache, null, 2), "utf8");
  await rename(tmp, FILE);
}

/** Entrée en cache si encore fraîche (< 1 jour), sinon null. */
export async function getCachedReco(stream: string): Promise<CacheEntry | null> {
  const entry = (await readCache())[stream];
  if (entry && Date.now() - new Date(entry.generatedAt).getTime() < TTL_MS) return entry;
  return null;
}

/** Stocke les recommandations d'un flux (partagées par tous les comptes). */
export async function setCachedReco(stream: string, items: Recommendation[]): Promise<CacheEntry> {
  const cache = await readCache();
  const entry: CacheEntry = { generatedAt: new Date().toISOString(), items };
  cache[stream] = entry;
  await writeCache(cache);
  return entry;
}
