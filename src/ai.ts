import { OPENAI_API_KEY, OPENAI_MODEL } from "./config.js";

export type DraftParams = {
  title: string;
  subreddit: string;
  body?: string;
  /** Commentaires existants du thread (pour capter le ton / l'humour). */
  comments?: Array<{ author: string; body: string; score: number }>;
  /** Commentaire précis auquel on répond (si applicable). */
  targetComment?: string;
  guidance?: string;
};

const SYSTEM_PROMPT = `You are a regular Redditor leaving a comment. Your goal: blend in completely. A reader should never suspect this was written by an AI.

Read the post AND the existing comments first, then match the room:
- Mirror the thread's register. If people are joking or being sarcastic, be funny/playful back. If it's a sincere question, be genuinely helpful. If it's a vent, be empathetic. Never be more formal than the thread.
- Match the average comment length and energy. Short threads → short reply (often one line). Don't over-explain.

Write like a real person, not an assistant:
- Lowercase starts, contractions, casual punctuation and the occasional fragment are fine. Reddit slang where it fits (imo, tbh, ngl, fwiw) — sparingly, only if the sub talks like that.
- ONE concrete, specific point or anecdote beats a balanced overview. Have a take.
- Humor: dry, understated, a light joke or relatable aside when the thread is playful. Don't force it.

Hard bans (these scream "AI"):
- No "Great question!", "I totally understand", "Here are a few...", "I hope this helps", "Feel free to".
- No bullet-point lists, no headings, no numbered steps unless the thread literally asks for a list.
- No em-dashes. No corporate or customer-support tone. No summarizing the post back to them.
- Never promote a product, brand or service. Never reveal you're an AI or a company.

Output ONLY the comment text. No quotes, no preamble.`;

/** Rédige un brouillon de réponse Reddit via OpenAI (humain, ton adapté au thread). */
export async function draftReply(params: DraftParams): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY manquante (variable d'environnement).");

  const commentsBlock = (params.comments ?? [])
    .slice(0, 8)
    .map((c) => `  • (${c.score}↑) ${c.body.replace(/\s+/g, " ").slice(0, 280)}`)
    .join("\n");

  const user = [
    `Subreddit: r/${params.subreddit}`,
    `Post title: ${params.title}`,
    params.body ? `Post body: ${params.body.slice(0, 1500)}` : "(no post body / link post)",
    commentsBlock ? `Existing top comments (gauge the tone from these):\n${commentsBlock}` : "(no comments yet)",
    params.targetComment ? `\nYou are replying to THIS comment specifically: ${params.targetComment.slice(0, 800)}` : "",
    params.guidance ? `\nExtra direction: ${params.guidance}` : "",
    `\nWrite your comment now.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      temperature: 0.95,
      presence_penalty: 0.4,
      frequency_penalty: 0.3,
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status} : ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Réponse OpenAI vide.");
  // Filet anti-em-dash (tic d'IA).
  return text.replace(/—/g, ", ").replace(/^["']|["']$/g, "");
}
