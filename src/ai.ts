import { OPENAI_API_KEY, OPENAI_MODEL } from "./config.js";

export type DraftParams = {
  title: string;
  subreddit: string;
  body?: string;
  targetComment?: string;
  tone?: string;
  length?: string;
  guidance?: string;
};

/**
 * Rédige un brouillon de réponse Reddit via l'API OpenAI. Réponse en anglais
 * (marché US), naturelle, utile, NON promotionnelle (pas de mention de marque).
 */
export async function draftReply(params: DraftParams): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY manquante (variable d'environnement).");
  }

  const tone = params.tone ?? "friendly, genuine, helpful";
  const length = params.length ?? "2-4 sentences";

  const system = [
    "You are a real Reddit user writing a reply on a US subreddit.",
    "Write a genuinely helpful, on-topic comment that adds value to the discussion.",
    "Rules:",
    "- Sound like a real person, casual Reddit tone. No corporate or marketing language.",
    "- Do NOT promote any product, brand, or service. Do NOT mention being a company.",
    "- Be specific and useful; avoid generic filler.",
    `- Tone: ${tone}. Length: ${length}. Language: English.`,
    params.guidance ? `- Extra guidance: ${params.guidance}` : "",
    "Output only the reply text, nothing else.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Subreddit: r/${params.subreddit}`,
    `Post title: ${params.title}`,
    params.body ? `Post body: ${params.body.slice(0, 1500)}` : "",
    params.targetComment ? `You are replying to this comment: ${params.targetComment.slice(0, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status} : ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Réponse OpenAI vide.");
  return text;
}
