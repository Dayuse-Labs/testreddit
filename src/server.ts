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
import {
  draftCreateInput,
  draftReplyInput,
  draftUpdateInput,
  previewInput,
  replyInput,
  scheduleInput,
} from "./schemas.js";
import { fetchPreview } from "./reddit/preview.js";
import { getEgressIp } from "./reddit/browser.js";
import { fetchUserActivity } from "./reddit/read.js";
import { recommendDayuse, recommendGeneric } from "./recommend/recommend.js";
import { draftReply } from "./ai.js";
import { addDraft, readDrafts, removeDraft, updateDraft } from "./drafts/store.js";
import { postReply } from "./reddit/poster.js";
import { parseRedditUrl } from "./reddit/url.js";
import {
  addAccount,
  defaultAccountId,
  getAccount,
  publicAccounts,
  removeAccount,
  slugifyId,
} from "./reddit/accounts.js";
import { accountCreateInput } from "./schemas.js";
import type { Account } from "./schemas.js";
import {
  disposeSession,
  getCachedState,
  isSwitching,
  refreshLogin,
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

/** Ajoute un compte (marché) depuis l'interface. */
app.post("/api/accounts", async (request, reply) => {
  const parsed = accountCreateInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  const d = parsed.data;
  const account: Account = {
    id: slugifyId(d.label),
    label: d.label,
    ...(d.redditUsername ? { redditUsername: d.redditUsername } : {}),
    ...(d.proxyServer
      ? {
          proxy: {
            server: d.proxyServer,
            ...(d.proxyUsername ? { username: d.proxyUsername } : {}),
            ...(d.proxyPassword ? { password: d.proxyPassword } : {}),
          },
        }
      : {}),
    ...(d.username && d.password
      ? {
          credentials: {
            username: d.username,
            password: d.password,
            ...(d.totpSecret ? { totpSecret: d.totpSecret } : {}),
          },
        }
      : {}),
  };
  addAccount(account);
  return { ok: true, id: account.id };
});

/** Supprime un compte ajouté via l'interface. */
app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (request, reply) => {
  const removed = removeAccount(request.params.id);
  if (!removed) {
    return reply.code(404).send({ error: "Compte introuvable ou non supprimable (compte d'environnement)." });
  }
  return { ok: true };
});

/** État de la connexion Reddit pour un compte. */
app.get<{ Querystring: { account?: string } }>("/api/status", async (request) => {
  if (isSwitching()) {
    return { loggedIn: false, user: null, headless: HEADLESS, switching: true, remote: !LOCAL_MODE };
  }
  const accountId = request.query.account ?? defaultAccountId();
  // Réponse instantanée depuis le cache. On NE déclenche PAS de login ici
  // (sécurité : évite une tempête de logins échoués qui pourrait verrouiller le
  // compte). Le login a lieu au démarrage et lors des actions (aperçu/publier).
  const cached = getCachedState(accountId);
  return {
    loggedIn: cached.loggedIn,
    user: cached.user,
    accountId,
    headless: HEADLESS,
    switching: false,
    remote: !LOCAL_MODE,
    pending: cached.pending,
    ...(cached.error && !cached.loggedIn ? { loginError: cached.error } : {}),
  };
});

/** IP de sortie réellement vue par les sites (diagnostic proxy) pour un compte. */
app.get<{ Querystring: { account?: string } }>("/api/ip", async (request) => {
  if (isSwitching()) return { ip: null, switching: true };
  const accountId = request.query.account ?? defaultAccountId();
  try {
    const ip = await withAccount(accountId, (context) => getEgressIp(context));
    return { ip, accountId, switching: false };
  } catch (error) {
    app.log.error({ err: error }, "ip: échec contexte/proxy");
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

/** Recommandations de threads (lecture .json authentifiée via la session). */
app.get<{ Querystring: { account?: string; stream?: string } }>(
  "/api/recommendations",
  async (request, reply) => {
    const accountId = request.query.account ?? defaultAccountId();
    const stream = request.query.stream === "dayuse" ? "dayuse" : "generic";
    try {
      // Lecture via la session existante (pas d'auto-login fragile).
      const recos = await withAccount(accountId, (context) =>
        stream === "dayuse" ? recommendDayuse(context) : recommendGeneric(context),
      );
      return { recommendations: recos, accountId, stream };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
  },
);

/** Activité publiée par un compte (commentaires + posts, .json authentifié). */
app.get<{ Querystring: { account?: string; user?: string } }>("/api/published", async (request, reply) => {
  const accountId = request.query.account ?? defaultAccountId();
  const user = request.query.user ?? getAccount(accountId)?.redditUsername;
  if (!user) {
    return reply.code(400).send({ error: "Pseudo Reddit requis (?user= ou champ redditUsername du compte)." });
  }
  try {
    const activity = await withAccount(accountId, (context) => fetchUserActivity(context, user));
    return { activity, user, accountId };
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Brouillon de réponse assisté par Gemini. */
app.post("/api/draft-reply", async (request, reply) => {
  const parsed = draftReplyInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  try {
    const text = await draftReply(parsed.data);
    return { text };
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** File de brouillons (réponses préparées, publiées par un humain). */
app.get("/api/drafts", async () => {
  return readDrafts();
});

app.post("/api/drafts", async (request, reply) => {
  const parsed = draftCreateInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  const id = parsed.data.accountId ?? defaultAccountId();
  const draft = await addDraft(
    {
      accountId: id,
      accountLabel: getAccount(id)?.label ?? id,
      targetUrl: parsed.data.targetUrl,
      title: parsed.data.title,
      subreddit: parsed.data.subreddit,
      text: parsed.data.text,
      source: parsed.data.source,
    },
    new Date().toISOString(),
  );
  return draft;
});

app.patch<{ Params: { id: string } }>("/api/drafts/:id", async (request, reply) => {
  const parsed = draftUpdateInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "posted") patch.postedAt = new Date().toISOString();
  const updated = await updateDraft(request.params.id, patch);
  if (!updated) return reply.code(404).send({ error: "Brouillon introuvable" });
  return updated;
});

app.delete<{ Params: { id: string } }>("/api/drafts/:id", async (request, reply) => {
  const removed = await removeDraft(request.params.id);
  if (!removed) return reply.code(404).send({ error: "Brouillon introuvable" });
  return { ok: true };
});

/** Historique des réponses publiées (legacy, automatisation). */
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
  // Connexion proactive du compte par défaut, en arrière-plan.
  refreshLogin(defaultAccountId());
  app.log.info(`Outil de réponse Reddit : http://${HOST}:${PORT} (headless=${HEADLESS})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
