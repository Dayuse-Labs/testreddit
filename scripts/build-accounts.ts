import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNTS_FILE, DATA_DIR } from "../src/config.js";
import { accountsSchema } from "../src/schemas.js";

/**
 * Assemble la liste des comptes (data/accounts.local.json) en une seule valeur
 * base64 à coller dans la variable d'environnement ACCOUNTS_B64 (Railway).
 * La valeur est écrite dans un fichier, jamais affichée (ce sont des identifiants).
 */
async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(ACCOUNTS_FILE, "utf8");
  } catch {
    console.error(`❌ ${ACCOUNTS_FILE} introuvable. Ajoute d'abord des comptes : npm run add-account ...`);
    process.exit(1);
    return;
  }

  const parsed = accountsSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.length === 0) {
    console.error("❌ Liste de comptes invalide ou vide :", parsed.success ? "vide" : parsed.error.message);
    process.exit(1);
    return;
  }

  const b64 = Buffer.from(JSON.stringify(parsed.data)).toString("base64");
  const outFile = path.join(DATA_DIR, "ACCOUNTS_B64.txt");
  await writeFile(outFile, b64, "utf8");

  console.log(`✅ ${parsed.data.length} compte(s) : ${parsed.data.map((a) => a.label).join(", ")}`);
  console.log(`\nFichier : ${outFile}`);
  console.log("Ouvre-le, copie son contenu, et colle-le dans la variable ACCOUNTS_B64 de Railway.");
  console.log("⚠️  Contenu = sessions + identifiants proxy. Ne le partage avec personne.");
}

main().catch((error) => {
  console.error("Erreur :", error);
  process.exit(1);
});
