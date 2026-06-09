import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AUTH_FILE, DATA_DIR } from "../src/config.js";

/**
 * Génère la variable d'environnement REDDIT_SESSION_B64 à partir de la session
 * exportée (data/auth.json). La valeur est écrite dans un FICHIER, jamais
 * affichée à l'écran, pour éviter de la coller par accident quelque part.
 */
async function main(): Promise<void> {
  let json: string;
  try {
    json = await readFile(AUTH_FILE, "utf8");
  } catch {
    console.error(`❌ ${AUTH_FILE} introuvable. Lance d'abord : npm run login`);
    process.exit(1);
    return;
  }

  const b64 = Buffer.from(json).toString("base64");
  const outFile = path.join(DATA_DIR, "REDDIT_SESSION_B64.txt");
  await writeFile(outFile, b64, "utf8");

  console.log("✅ Variable d'environnement générée.");
  console.log(`\nFichier : ${outFile}`);
  console.log("\nOuvre ce fichier, copie son contenu, et colle-le dans la variable");
  console.log("REDDIT_SESSION_B64 de Railway (Variables → New Variable).");
  console.log("\n⚠️  Ce contenu = tes identifiants Reddit. Ne le partage avec personne.");
}

main().catch((error) => {
  console.error("Erreur :", error);
  process.exit(1);
});
