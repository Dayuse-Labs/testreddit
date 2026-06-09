import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { mkdir } from "node:fs/promises";
import {
  APP_PASSWORD,
  APP_USER,
  HEADLESS,
  HOST,
  PORT,
  PROXY_ENABLED,
  PUBLIC_DIR,
  REMOTE_MODE,
  SCREENSHOTS_DIR,
} from "./config.js";
import { previewInput, replyInput, scheduleInput } from "./schemas.js";
import { fetchPreview } from "./reddit/preview.js";
import { getEgressIp, getLoggedInUser } from "./reddit/browser.js";
import { postReply } from "./reddit/poster.js";
import {
  disposeSession,
  getContext,
  isSwitching,
  runExclusive,
  startAccountSwitch,
} from "./reddit/session.js";
import { appendHistory, readHistory, type HistoryEntry } from "./history/store.js";
import {
  addSchedule,
  readSchedule,
  removeSchedule,
} from "./schedule/store.js";
import { startScheduler } from "./schedule/scheduler.js";

const app = Fastify({ logger: { transport: undefined } });

// --- Protection optionnelle par Basic Auth ----------------------------------
// Activée dès que APP_PASSWORD est défini (indispensable si exposé sur Internet).
if (APP_PASSWORD) {
  const expected = "Basic " + Buffer.from(`${APP_USER}:${APP_PASSWORD}`).toString("base64");
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.authorization !== expected) {
      return reply
        .code(401)
        .header("WWW-Authenticate", 'Basic realm="Réponses Reddit"')
        .send({ error: "Authentification requise" });
    }
  });
}

// --- Fichiers statiques ------------------------------------------------------
await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/" });
await mkdir(SCREENSHOTS_DIR, { recursive: true });
await app.register(fastifyStatic, {
  root: SCREENSHOTS_DIR,
  prefix: "/screenshots/",
  decorateReply: false,
});

// --- Routes API --------------------------------------------------------------

/** État de la connexion Reddit. */
app.get("/api/status", async () => {
  if (isSwitching()) {
    return { loggedIn: false, user: null, headless: HEADLESS, switching: true, remote: REMOTE_MODE };
  }
  const context = await getContext();
  const user = await getLoggedInUser(context);
  return { loggedIn: user !== null, user, headless: HEADLESS, switching: false, remote: REMOTE_MODE };
});

/** IP de sortie réellement vue par les sites (diagnostic proxy). */
app.get("/api/ip", async () => {
  if (isSwitching()) return { ip: null, proxy: PROXY_ENABLED, switching: true };
  const context = await getContext();
  const ip = await getEgressIp(context);
  return { ip, proxy: PROXY_ENABLED, switching: false };
});

/** Changement de compte : déconnexion + ouverture d'une fenêtre de login (local uniquement). */
app.post("/api/switch-account", async (_request, reply) => {
  try {
    await startAccountSwitch();
    return { ok: true, message: "Fenêtre de connexion ouverte. Connecte-toi au nouveau compte." };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Aperçu du fil ciblé (via la session connectée). */
app.post("/api/preview", async (request, reply) => {
  const parsed = previewInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  if (isSwitching()) {
    return reply.code(409).send({ error: "Changement de compte en cours, réessaie dans un instant." });
  }

  try {
    const context = await getContext();
    const preview = await fetchPreview(context, parsed.data.url);
    return preview;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(502).send({ error: message });
  }
});

/** Publication immédiate d'une réponse + journalisation. */
app.post("/api/reply", async (request, reply) => {
  const parsed = replyInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  if (isSwitching()) {
    return reply.code(409).send({ error: "Changement de compte en cours, réessaie dans un instant." });
  }

  const { url, text } = parsed.data;
  const timestamp = new Date().toISOString();

  const result = await runExclusive(async () => {
    const context = await getContext();
    return postReply(context, url, text, timestamp);
  });

  const entry: HistoryEntry = {
    id: timestamp,
    timestamp,
    targetUrl: result.target.canonicalUrl,
    type: result.target.type,
    text,
    status: result.success ? "success" : "error",
    loggedInUser: result.loggedInUser,
    ...(result.error ? { error: result.error } : {}),
    ...(result.screenshotFile ? { screenshotFile: result.screenshotFile } : {}),
  };
  await appendHistory(entry);

  if (!result.success) {
    return reply.code(502).send(entry);
  }
  return entry;
});

/** Programmation d'un envoi futur. */
app.post("/api/schedule", async (request, reply) => {
  const parsed = scheduleInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  const item = await addSchedule(parsed.data, new Date().toISOString());
  return item;
});

/** Liste des envois programmés (tous statuts, plus récents en premier). */
app.get("/api/schedule", async () => {
  const items = await readSchedule();
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});

/** Annulation d'un envoi programmé. */
app.delete<{ Params: { id: string } }>("/api/schedule/:id", async (request, reply) => {
  const removed = await removeSchedule(request.params.id);
  if (!removed) {
    return reply.code(404).send({ error: "Envoi programmé introuvable" });
  }
  return { ok: true };
});

/** Historique des réponses publiées. */
app.get("/api/history", async () => {
  return readHistory();
});

// --- Démarrage / arrêt propre ------------------------------------------------
async function shutdown(): Promise<void> {
  try {
    await disposeSession();
  } catch {
    // ignore
  }
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host: HOST, port: PORT });
  startScheduler((msg) => app.log.info(msg));
  app.log.info(`Outil de réponse Reddit : http://${HOST}:${PORT} (headless=${HEADLESS})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
