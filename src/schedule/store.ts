import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DATA_DIR, SCHEDULE_FILE } from "../config.js";

export type ScheduledItem = {
  id: string;
  url: string;
  text: string;
  /** Date d'envoi prévue (ISO 8601). */
  sendAt: string;
  createdAt: string;
  status: "pending" | "sent" | "error";
  accountId?: string;
  accountLabel?: string;
  /** Renseignés après tentative d'envoi. */
  type?: "post" | "comment";
  targetUrl?: string;
  error?: string;
  screenshotFile?: string;
  sentAt?: string;
};

async function writeAll(items: ScheduledItem[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, "schedule.tmp.json");
  await writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await rename(tmp, SCHEDULE_FILE);
}

/** Lit la file complète (tous statuts). Renvoie [] si absente. */
export async function readSchedule(): Promise<ScheduledItem[]> {
  try {
    const raw = await readFile(SCHEDULE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ScheduledItem[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Ajoute un envoi programmé et renvoie l'entrée créée. */
export async function addSchedule(
  input: {
    url: string;
    text: string;
    sendAt: string;
    accountId?: string;
    accountLabel?: string;
  },
  createdAt: string,
): Promise<ScheduledItem> {
  const items = await readSchedule();
  const item: ScheduledItem = {
    id: randomUUID(),
    url: input.url,
    text: input.text,
    sendAt: input.sendAt,
    createdAt,
    status: "pending",
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.accountLabel ? { accountLabel: input.accountLabel } : {}),
  };
  items.push(item);
  await writeAll(items);
  return item;
}

/** Applique une mise à jour partielle à l'élément `id`. */
export async function updateSchedule(
  id: string,
  patch: Partial<ScheduledItem>,
): Promise<void> {
  const items = await readSchedule();
  const next = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  await writeAll(next);
}

/** Supprime un envoi programmé. Renvoie vrai s'il a été trouvé et retiré. */
export async function removeSchedule(id: string): Promise<boolean> {
  const items = await readSchedule();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeAll(next);
  return true;
}
