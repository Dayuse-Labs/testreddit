import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, HISTORY_FILE } from "../config.js";

export type HistoryEntry = {
  id: string;
  timestamp: string;
  targetUrl: string;
  type: "post" | "comment";
  text: string;
  status: "success" | "error";
  error?: string;
  screenshotFile?: string;
  loggedInUser?: string | null;
};

/** Lit l'historique complet (plus récent en premier). Renvoie [] si absent. */
export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Ajoute une entrée en tête de l'historique (lecture-modif-écriture).
 * Mono-utilisateur : pas de verrou nécessaire.
 */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const entries = await readHistory();
  entries.unshift(entry);
  // Écriture atomique : fichier temporaire puis renommage.
  const tmp = path.join(DATA_DIR, "history.tmp.json");
  await writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await rename(tmp, HISTORY_FILE);
}
