import { GEMINI_API_KEY, GEMINI_MODEL } from "./config.js";

export type DraftParams = {
  title: string;
  subreddit: string;
  body?: string;
  /** Commentaire ciblé si on répond à un commentaire précis. */
  targetComment?: string;
  /** Ton souhaité (ex. "amical et utile"). */
  tone?: string;
  /** Longueur indicative (ex. "2-3 phrases"). */
  length?: string;
  /** Consignes additionnelles libres. */
  guidance?: string;
};

/**
 * Rédige un brouillon de réponse Reddit via l'API Gemini. Réponse en anglais
 * (marché US), naturelle, utile, NON promotionnelle (pas de mention de marque).
 */
export async function draftReply(params: DraftParams): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY manquante (variable d'environnement).");
  }

  const tone = params.tone ?? "friendly, genuine, helpful";
  const length = params.length ?? "2-4 sentences";

  const prompt = [
    "You are a real Reddit user writing a reply on a US subreddit.",
    "Write a genuinely helpful, on-topic comment that adds value to the discussion.",
    "Rules:",
    "- Sound like a real person, casual Reddit tone. No corporate or marketing language.",
    "- Do NOT promote any product, brand, or service. Do NOT mention being a company.",
    "- Be specific and useful; avoid generic filler.",
    `- Tone: ${tone}. Length: ${length}. Language: English.`,
    params.guidance ? `- Extra guidance: ${params.guidance}` : "",
    "",
    `Subreddit: r/${params.subreddit}`,
    `Post title: ${params.title}`,
    params.body ? `Post body: ${params.body.slice(0, 1500)}` : "",
    params.targetComment ? `You are replying to this comment: ${params.targetComment.slice(0, 800)}` : "",
    "",
    "Write only the reply text, nothing else.",
  ]
    .filter(Boolean)
    .join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini HTTP ${response.status} : ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Réponse Gemini vide.");
  return text;
}
