import { appendHistory, type HistoryEntry } from "../history/store.js";
import { isSwitching, withLoggedInAccount } from "../reddit/session.js";
import { postReply } from "../reddit/poster.js";
import { parseRedditUrl } from "../reddit/url.js";
import { readSchedule, updateSchedule } from "./store.js";

/** Intervalle de vérification de la file (ms). */
const TICK_MS = 30_000;

let running = false;

/**
 * Démarre le planificateur local : toutes les 30 s, publie les envois dont la
 * date est échue. Ne tourne que tant que le serveur est lancé.
 */
export function startScheduler(log: (msg: string) => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    void tick(log);
  }, TICK_MS);
  // Ne bloque pas l'arrêt du process.
  timer.unref?.();
  return timer;
}

async function tick(log: (msg: string) => void): Promise<void> {
  // Évite les chevauchements et n'agit pas pendant un changement de compte.
  if (running || isSwitching()) return;
  running = true;
  try {
    const items = await readSchedule();
    const now = Date.now();
    const due = items.filter(
      (item) => item.status === "pending" && new Date(item.sendAt).getTime() <= now,
    );

    for (const item of due) {
      const timestamp = new Date().toISOString();
      log(`Envoi programmé ${item.id} → publication`);

      const result = await withLoggedInAccount(item.accountId, async (context, login) => {
        if (!login.ok) {
          return {
            success: false as const,
            target: parseRedditUrl(item.url),
            loggedInUser: null,
            error: login.error ?? "Compte non connecté",
          };
        }
        return postReply(context, item.url, item.text, timestamp);
      });

      await updateSchedule(item.id, {
        status: result.success ? "sent" : "error",
        sentAt: timestamp,
        type: result.target.type,
        targetUrl: result.target.canonicalUrl,
        ...(result.error ? { error: result.error } : {}),
        ...(result.screenshotFile ? { screenshotFile: result.screenshotFile } : {}),
      });

      const entry: HistoryEntry = {
        id: timestamp,
        timestamp,
        targetUrl: result.target.canonicalUrl,
        type: result.target.type,
        text: item.text,
        status: result.success ? "success" : "error",
        loggedInUser: result.loggedInUser,
        ...(item.accountId ? { accountId: item.accountId } : {}),
        ...(item.accountLabel ? { accountLabel: item.accountLabel } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.screenshotFile ? { screenshotFile: result.screenshotFile } : {}),
      };
      await appendHistory(entry);
    }
  } catch (error) {
    log(`Erreur planificateur : ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    running = false;
  }
}
