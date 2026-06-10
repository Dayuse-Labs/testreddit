import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { mkdir } from "node:fs/promises";
import {
  APP_PASSWORD,
  APP_USER,
  HEADLESS,
  HOST,
  LOCAL_MODE,
  PORT,
  PUBLIC_DIR,
  SCREENSHOTS_DIR,
} from "./config.js";
import { previewInput, replyInput, scheduleInput } from "./schemas.js";
import { fetchPreview } from "./reddit/preview.js";
import { getEgressIp } from "./reddit/browser.js";
import { postReply } from "./reddit/poster.js";
import { parseRedditUrl } from "./reddit/url.js";
import {
  defaultAccountId,
  getAccount,
  publicAccounts,
} from "./reddit/accounts.js";
import {
  disposeSession,
  isSwitching,
  startAccountSwitch,
  withAccount,
  withLoggedInAccount,
} from "./reddit/session.js";
import { appendHistory, readHistory, type HistoryEntry } from "./history/store.js";
import { addSchedule, readSchedule, removeSchedule } from "./schedule/store.js";
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

// Renvoie un libellé pour un compte (pour journalisation).
function accountLabel(id: string | undefined): string {
  const resolved = id ?? defaultAccountId();
  return getAccount(resolved)?.label ?? resolved;
}

// --- Routes API --------------------------------------------------------------

/** Liste des comptes configurés (sans secrets) + compte par défaut. */
app.get("/api/accounts", async () => {
  return { accounts: publicAccounts(), defaultId: defaultAccountId(), managed: !LOCAL_MODE };
});

/** État de la connexion Reddit pour un compte. */
app.get<{ Querystring: { account?: string } }>("/api/status", async (request) => {
  if (isSwitching()) {
    return { loggedIn: false, user: null, headless: HEADLESS, switching: true, remote: !LOCAL_MODE };
  }
  const accountId = request.query.account ?? defaultAccountId();
  try {
    // Vérifie la connexion et tente une reconnexion auto si déconnecté.
    const login = await withLoggedInAccount(accountId, async (_context, result) => result);
    return {
      loggedIn: login.ok,
      user: login.user ?? null,
      accountId,
      headless: HEADLESS,
      switching: false,
      remote: !LOCAL_MODE,
      ...(login.ok ? {} : { loginError: login.error }),
    };
  } catch (error) {
    return {
      loggedIn: false,
      user: null,
      accountId,
      headless: HEADLESS,
      switching: false,
      remote: !LOCAL_MODE,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/** IP de sortie réellement vue par les sites (diagnostic proxy) pour un compte. */
app.get<{ Querystring: { account?: string } }>("/api/ip", async (request) => {
  if (isSwitching()) return { ip: null, switching: true };
  const accountId = request.query.account ?? defaultAccountId();
  try {
    const ip = await withAccount(accountId, (context) => getEgressIp(context));
    return { ip, accountId, switching: false };
  } catch (error) {
    return { ip: null, accountId, switching: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Re-login local (mode local uniquement). */
app.post("/api/switch-account", async (_request, reply) => {
  try {
    await startAccountSwitch();
    return { ok: true, message: "Fenêtre de connexion ouverte. Connecte-toi au nouveau compte." };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Aperçu du fil ciblé (via la session du compte choisi). */
app.post("/api/preview", async (request, reply) => {
  const parsed = previewInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  if (isSwitching()) {
    return reply.code(409).send({ error: "Changement de compte en cours, réessaie dans un instant." });
  }

  try {
    const preview = await withLoggedInAccount(parsed.data.accountId, async (context, login) => {
      if (!login.ok) throw new Error(login.error ?? "Compte non connecté");
      return fetchPreview(context, parsed.data.url);
    });
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

  const { url, text, accountId } = parsed.data;
  const timestamp = new Date().toISOString();

  const result = await withLoggedInAccount(accountId, async (context, login) => {
    if (!login.ok) {
      return {
        success: false as const,
        target: parseRedditUrl(url),
        loggedInUser: null,
        error: login.error ?? "Compte non connecté",
        ...(login.screenshotFile ? { screenshotFile: login.screenshotFile } : {}),
      };
    }
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
    accountId: accountId ?? defaultAccountId(),
    accountLabel: accountLabel(accountId),
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
  const item = await addSchedule(
    { ...parsed.data, accountLabel: accountLabel(parsed.data.accountId) },
    new Date().toISOString(),
  );
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
