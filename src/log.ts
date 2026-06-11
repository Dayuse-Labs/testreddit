export type LogLine = { i: number; t: string; msg: string };

const buffer: LogLine[] = [];
let counter = 0;
const MAX = 300;

/** Ajoute une ligne au journal en direct (consultable via /api/logs). */
export function logLine(msg: string): void {
  counter += 1;
  buffer.push({ i: counter, t: new Date().toISOString(), msg });
  if (buffer.length > MAX) buffer.shift();
  // Aussi sur stdout (logs Railway).
  console.log(`[live] ${msg}`);
}

/** Lignes ajoutées depuis l'index `since` (polling incrémental). */
export function getLogsSince(since: number): { lines: LogLine[]; last: number } {
  return { lines: buffer.filter((l) => l.i > since), last: counter };
}
