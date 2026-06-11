import { z } from "zod";

/** Vérifie qu'une URL pointe bien vers un fil Reddit (post ou commentaire). */
const redditUrl = z
  .string()
  .trim()
  .url("URL invalide")
  .refine((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === "reddit.com" || host.endsWith(".reddit.com");
    } catch {
      return false;
    }
  }, "L'URL doit être un lien reddit.com")
  .refine(
    (value) => value.includes("/comments/"),
    "L'URL doit pointer vers un post ou un commentaire (/comments/...)",
  );

/** Identifiant de compte optionnel (défaut : premier compte configuré). */
const accountId = z.string().trim().min(1).optional();

export const proxyConfigSchema = z.object({
  server: z.string().trim().min(1),
  username: z.string().optional(),
  password: z.string().optional(),
});

export const credentialsSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  /** Secret TOTP (base32) si le compte a la 2FA par application. Optionnel. */
  totpSecret: z.string().trim().optional(),
});

export const accountSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  /** Session exportée (legacy). Optionnelle. */
  sessionB64: z.string().min(1).optional(),
  /** Identifiants pour la reconnexion automatique (publication). Optionnels. */
  credentials: credentialsSchema.optional(),
  /** Pseudo Reddit affiché (u/…), pour l'onglet « Publié ». */
  redditUsername: z.string().trim().optional(),
  /** Proxy résidentiel explicite (legacy / avancé). Sinon, généré via proxyCountry. */
  proxy: proxyConfigSchema.optional(),
  /**
   * Pays de l'IP résidentielle dédiée (code à 2 lettres, ex. « us », « fr »).
   * Le proxy complet est généré automatiquement depuis la base Decodo + un
   * jeton de session unique par compte (IP distincte par compte).
   */
  proxyCountry: z.string().trim().toLowerCase().min(2).max(2).optional(),
  /** true uniquement pour le compte local (profil persistant + login manuel). */
  local: z.boolean().optional(),
});

export const accountsSchema = z.array(accountSchema);

export const previewInput = z.object({
  url: redditUrl,
  accountId,
});

export const replyInput = z.object({
  url: redditUrl,
  text: z
    .string()
    .trim()
    .min(1, "Le texte de la réponse est vide")
    .max(10000, "Le texte dépasse la limite de Reddit (10 000 caractères)"),
  accountId,
});

export const scheduleInput = replyInput.extend({
  /** Date d'envoi au format ISO 8601 (ex. 2026-06-09T18:30:00.000Z). */
  sendAt: z
    .string()
    .datetime({ message: "Date d'envoi invalide" })
    .refine(
      (value) => new Date(value).getTime() > Date.now() - 60_000,
      "La date d'envoi doit être dans le futur",
    ),
});

export const sessionInput = z.object({
  accountId,
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string().optional(),
        secure: z.boolean().optional(),
        httpOnly: z.boolean().optional(),
        sameSite: z.string().optional(),
        expirationDate: z.number().optional(),
      }),
    )
    .min(1, "Aucun cookie reçu"),
});

export const accountCreateInput = z.object({
  label: z.string().trim().min(1, "Nom du compte requis"),
  redditUsername: z.string().trim().optional(),
  /** Pays de l'IP dédiée (code à 2 lettres). Le proxy est généré automatiquement. */
  proxyCountry: z.string().trim().toLowerCase().min(2).max(2).optional(),
  /** Proxy explicite (avancé) — laissé pour compatibilité, non requis. */
  proxyServer: z.string().trim().optional(),
  proxyUsername: z.string().trim().optional(),
  proxyPassword: z.string().optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  totpSecret: z.string().trim().optional(),
});

export const draftReplyInput = z.object({
  title: z.string().trim().min(1),
  subreddit: z.string().trim().min(1),
  body: z.string().optional(),
  comments: z
    .array(z.object({ author: z.string(), body: z.string(), score: z.number() }))
    .optional(),
  targetComment: z.string().optional(),
  guidance: z.string().optional(),
});

export const draftCreateInput = z.object({
  accountId,
  targetUrl: redditUrl,
  title: z.string().trim().min(1),
  subreddit: z.string().trim().min(1),
  text: z.string().trim().min(1),
  source: z.enum(["generic", "dayuse", "manual"]).default("manual"),
});

export const draftUpdateInput = z.object({
  text: z.string().trim().min(1).optional(),
  status: z.enum(["todo", "posted"]).optional(),
});

export type Account = z.infer<typeof accountSchema>;
export type ProxyConfig = z.infer<typeof proxyConfigSchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type PreviewInput = z.infer<typeof previewInput>;
export type ReplyInput = z.infer<typeof replyInput>;
export type ScheduleInput = z.infer<typeof scheduleInput>;
