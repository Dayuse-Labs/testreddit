import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import { mkdir } from "node:fs/promises";
import {
  APP_PASSWORD,
  APP_USER,
  ENABLE_VNC,
  HEADLESS,
  HOST,
  LOCAL_MODE,
  NOVNC_PORT,
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
import { fetchPreview, fetchThreadContext } from "./reddit/preview.js";
import { getEgressIp, getLoggedInUser } from "./reddit/browser.js";
import { fetchUserActivity } from "./reddit/read.js";
import { recommendDayuse, recommendGeneric } from "./recommend/recommend.js";
import { getCachedReco, setCachedReco } from "./recommend/cache.js";
import { draftReply } from "./ai.js";
import { addDraft, readDrafts, removeDraft, updateDraft } from "./drafts/store.js";
import { postReply } from "./reddit/poster.js";
import { parseRedditUrl } from "./reddit/url.js";
import {
  addAccount,
  defaultAccountId,
  getAccount,
  proxyBaseConfigured,
  publicAccounts,
  removeAccount,
  rotateAccountIp,
  slugifyId,
} from "./reddit/accounts.js";
import { accountCreateInput } from "./schemas.js";
import type { Account } from "./schemas.js";
import {
  disposeSession,
  isSwitching,
  resetContext,
  resetLoginCooldown,
  startAccountSwitch,
  startManualLogin,
  withAccount,
  withLoggedInAccount,
} from "./reddit/session.js";
import { setInjectedSession, type StorageState } from "./reddit/injected-sessions.js";
import { sessionInput } from "./schemas.js";
import { appendHistory, readHistory, type HistoryEntry } from "./history/store.js";
import { addSchedule, readSchedule, removeSchedule } from "./schedule/store.js";
import { startScheduler } from "./schedule/scheduler.js";
import { getLogsSince, logLine } from "./log.js";

const app = Fastify({ logger: { transport: undefined } });

// --- Protection optionnelle par Basic Auth ----------------------------------
// Activée dès que APP_PASSWORD est défini (indispensable si exposé sur Internet).
if (APP_PASSWORD) {
  const expected = "Basic " + Buffer.from(`${APP_USER}:${APP_PASSWORD}`).toString("base64");
  app.addHook("onRequest", async (request, reply) => {
    // /novnc exempté : le flux VNC (iframe + websocket) ne porte pas le Basic Auth.
    if (request.url.startsWith("/novnc")) return;
    if (request.headers.authorization !== expected) {
      return reply
        .code(401)
        .header("WWW-Authenticate", 'Basic realm="Réponses Reddit"')
        .send({ error: "Authentification requise" });
    }
  });
}

// --- Navigateur distant (noVNC) : proxy du client + websocket vers websockify ---
if (ENABLE_VNC) {
  await app.register(fastifyHttpProxy, {
    upstream: `http://127.0.0.1:${NOVNC_PORT}`,
    prefix: "/novnc",
    rewritePrefix: "",
    websocket: true,
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
  return {
    accounts: publicAccounts(),
    defaultId: defaultAccountId(),
    managed: !LOCAL_MODE,
    // true = base Decodo configurée → l'UI peut générer une IP dédiée par pays.
    proxyAuto: proxyBaseConfigured(),
  };
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
    // IP dédiée auto : on stocke juste le pays, le proxy complet est généré
    // (base Decodo + jeton de session unique par compte) au lancement.
    ...(d.proxyCountry ? { proxyCountry: d.proxyCountry } : {}),
    // Proxy explicite (avancé) : seulement si fourni ET pas de pays choisi.
    ...(!d.proxyCountry && d.proxyServer
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

/** Change l'IP résidentielle d'un compte (nouveau jeton de session Decodo). */
app.post<{ Params: { id: string } }>("/api/accounts/:id/rotate-ip", async (request, reply) => {
  const id = request.params.id;
  const account = getAccount(id);
  if (!account) {
    return reply.code(404).send({ error: "Compte introuvable." });
  }
  if (!proxyBaseConfigured() && !account.proxy?.server) {
    return reply.code(400).send({ error: "Aucun proxy configuré pour ce compte — rien à faire tourner." });
  }
  const rotation = rotateAccountIp(id);
  // Ferme le contexte courant : la prochaine connexion repartira sur la nouvelle IP.
  await resetContext();
  logLine(`🔄 Nouvelle IP pour « ${accountLabel(id)} » (rotation #${rotation}). Relance « Se connecter (manuel) ».`);
  return { ok: true, rotation };
});

/** État de connexion d'un compte : vérification en LECTURE (sans auto-login). */
app.get<{ Querystring: { account?: string } }>("/api/status", async (request) => {
  if (isSwitching()) {
    return { loggedIn: false, user: null, switching: true };
  }
  const accountId = request.query.account ?? defaultAccountId();
  try {
    const user = await withAccount(accountId, (context) => getLoggedInUser(context));
    return { loggedIn: user !== null, user, accountId, switching: false };
  } catch (error) {
    return {
      loggedIn: false,
      user: null,
      accountId,
      switching: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/** Reconnexion forcée depuis le front (réinitialise le cooldown + tente le login). */
app.post<{ Querystring: { account?: string } }>("/api/reconnect", async (request) => {
  const accountId = request.query.account ?? defaultAccountId();
  resetLoginCooldown(accountId);
  logLine(`Reconnexion demandée pour « ${accountLabel(accountId)} »…`);
  const login = await withLoggedInAccount(accountId, async (_context, result) => result);
  return {
    ok: login.ok,
    user: login.user ?? null,
    accountId,
    ...(login.ok ? {} : { error: login.error }),
    ...(login.screenshotFile ? { screenshotFile: login.screenshotFile } : {}),
  };
});

/** Connexion manuelle : ouvre une fenêtre (local uniquement) pour login humain. */
app.post<{ Querystring: { account?: string } }>("/api/manual-login", async (request, reply) => {
  const accountId = request.query.account ?? defaultAccountId();
  try {
    await startManualLogin(accountId);
    return { ok: true, message: "Fenêtre ouverte — connecte-toi (CAPTCHA inclus). Le statut passera au vert." };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Injecte une session capturée depuis le navigateur de l'utilisateur (extension). */
function mapSameSite(s?: string): "Strict" | "Lax" | "None" {
  const v = (s ?? "").toLowerCase();
  if (v === "strict") return "Strict";
  if (v === "no_restriction" || v === "none") return "None";
  return "Lax";
}

app.post("/api/session", async (request, reply) => {
  const parsed = sessionInput.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Entrée invalide" });
  }
  const accountId = parsed.data.accountId ?? defaultAccountId();
  const cookies = parsed.data.cookies
    .filter((c) => c.domain.includes("reddit.com"))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? "/",
      expires: typeof c.expirationDate === "number" ? Math.floor(c.expirationDate) : -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? true,
      sameSite: mapSameSite(c.sameSite),
    }));

  if (!cookies.length) {
    return reply.code(400).send({ error: "Aucun cookie reddit.com dans la requête." });
  }

  const state: StorageState = { cookies, origins: [] };
  setInjectedSession(accountId, state);
  logLine(`Session injectée pour « ${accountLabel(accountId)} » (${cookies.length} cookies).`);
  await resetContext(); // le prochain accès relancera avec la session injectée

  // Vérifie immédiatement que la session est valide.
  try {
    const user = await withAccount(accountId, (context) => getLoggedInUser(context));
    logLine(user ? `Session injectée OK : u/${user}` : "Session injectée mais non connectée (cookies périmés ?)");
    return { ok: user !== null, user, accountId };
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Journal en direct (polling incrémental : ?since=<index>). */
app.get<{ Querystring: { since?: string } }>("/api/logs", async (request) => {
  const since = Number.parseInt(request.query.since ?? "0", 10) || 0;
  return getLogsSince(since);
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
app.get<{ Querystring: { account?: string; stream?: string; refresh?: string } }>(
  "/api/recommendations",
  async (request, reply) => {
    const accountId = request.query.account ?? defaultAccountId();
    const stream = request.query.stream === "dayuse" ? "dayuse" : "generic";

    // Recos identiques pour tous les comptes, rafraîchies 1×/jour → cache.
    if (request.query.refresh !== "1") {
      const cached = await getCachedReco(stream);
      if (cached) {
        return { recommendations: cached.items, stream, generatedAt: cached.generatedAt, cached: true };
      }
    }

    try {
      const recos = await withAccount(accountId, (context) =>
        stream === "dayuse" ? recommendDayuse(context) : recommendGeneric(context),
      );
      const entry = await setCachedReco(stream, recos);
      return { recommendations: recos, stream, generatedAt: entry.generatedAt, cached: false };
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

/** Contexte d'un thread (titre + corps + top commentaires) pour la rédaction. */
app.get<{ Querystring: { account?: string; url?: string } }>("/api/thread-context", async (request, reply) => {
  const url = request.query.url;
  if (!url) return reply.code(400).send({ error: "Paramètre ?url= requis." });
  const accountId = request.query.account ?? defaultAccountId();
  try {
    const ctx = await withAccount(accountId, (context) => fetchThreadContext(context, url));
    return ctx;
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Brouillon de réponse assisté par IA. */
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

/** Pré-charge les deux flux de recommandations en arrière-plan (cache chaud au boot). */
async function warmRecommendations(): Promise<void> {
  const accountId = defaultAccountId();
  for (const stream of ["generic", "dayuse"] as const) {
    if (await getCachedReco(stream)) continue; // déjà frais
    try {
      const recos = await withAccount(accountId, (context) =>
        stream === "dayuse" ? recommendDayuse(context) : recommendGeneric(context),
      );
      await setCachedReco(stream, recos);
      app.log.info(`Recos ${stream} préchargées : ${recos.length}`);
    } catch (error) {
      app.log.warn(`Préchargement ${stream} échoué : ${error instanceof Error ? error.message : error}`);
    }
  }
}

try {
  await app.listen({ host: HOST, port: PORT });
  startScheduler((msg) => app.log.info(msg));
  void warmRecommendations(); // cache chaud dès le démarrage
  app.log.info(`Outil de réponse Reddit : http://${HOST}:${PORT} (headless=${HEADLESS})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
