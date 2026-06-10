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

export const accountSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    /** Session exportée (legacy). Optionnelle si des identifiants sont fournis. */
    sessionB64: z.string().min(1).optional(),
    /** Identifiants pour la reconnexion automatique. */
    credentials: credentialsSchema.optional(),
    proxy: proxyConfigSchema.optional(),
    /** true uniquement pour le compte local (profil persistant + login manuel). */
    local: z.boolean().optional(),
  })
  .refine(
    (a) => Boolean(a.sessionB64 || a.credentials || a.local),
    "Chaque compte doit avoir des identifiants (credentials) ou une session.",
  );

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

export type Account = z.infer<typeof accountSchema>;
export type ProxyConfig = z.infer<typeof proxyConfigSchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type PreviewInput = z.infer<typeof previewInput>;
export type ReplyInput = z.infer<typeof replyInput>;
export type ScheduleInput = z.infer<typeof scheduleInput>;
