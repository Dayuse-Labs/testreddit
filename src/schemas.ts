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

export const previewInput = z.object({
  url: redditUrl,
});

export const replyInput = z.object({
  url: redditUrl,
  text: z
    .string()
    .trim()
    .min(1, "Le texte de la réponse est vide")
    .max(10000, "Le texte dépasse la limite de Reddit (10 000 caractères)"),
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

export type PreviewInput = z.infer<typeof previewInput>;
export type ReplyInput = z.infer<typeof replyInput>;
export type ScheduleInput = z.infer<typeof scheduleInput>;
