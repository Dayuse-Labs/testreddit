import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DATA_DIR, DRAFTS_FILE } from "../config.js";

export type Draft = {
  id: string;
  accountId: string;
  accountLabel: string;
  /** URL du post/commentaire ciblé (où l'humain ira publier). */
  targetUrl: string;
  title: string;
  subreddit: string;
  text: string;
  status: "todo" | "posted";
  source: "generic" | "dayuse" | "manual";
  createdAt: string;
  postedAt?: string;
};

async function writeAll(items: Draft[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, "drafts.tmp.json");
  await writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await rename(tmp, DRAFTS_FILE);
}

export async function readDrafts(): Promise<Draft[]> {
  try {
    const parsed = JSON.parse(await readFile(DRAFTS_FILE, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Draft[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function addDraft(
  input: Omit<Draft, "id" | "status" | "createdAt">,
  createdAt: string,
): Promise<Draft> {
  const items = await readDrafts();
  const draft: Draft = { ...input, id: randomUUID(), status: "todo", createdAt };
  items.unshift(draft);
  await writeAll(items);
  return draft;
}

export async function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft | null> {
  const items = await readDrafts();
  let updated: Draft | null = null;
  const next = items.map((d) => {
    if (d.id !== id) return d;
    updated = { ...d, ...patch };
    return updated;
  });
  if (!updated) return null;
  await writeAll(next);
  return updated;
}

export async function removeDraft(id: string): Promise<boolean> {
  const items = await readDrafts();
  const next = items.filter((d) => d.id !== id);
  if (next.length === items.length) return false;
  await writeAll(next);
  return true;
}
