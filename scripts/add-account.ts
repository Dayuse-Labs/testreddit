import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ACCOUNTS_FILE, AUTH_FILE, DATA_DIR } from "../src/config.js";
import { accountsSchema, type Account } from "../src/schemas.js";

/**
 * Enregistre le compte actuellement connecté (data/auth.json, produit par
 * `npm run switch` puis login) dans la liste locale data/accounts.local.json,
 * avec son proxy résidentiel dédié.
 *
 * Exemple :
 *   npm run add-account -- --label "France" \
 *     --proxy-server http://gate.decodo.com:10003 \
 *     --proxy-user user-martino99-country-fr-sessionduration-1440 \
 *     --proxy-pass MOT_DE_PASSE
 */

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readAccounts(): Promise<Account[]> {
  try {
    const parsed = accountsSchema.safeParse(JSON.parse(await readFile(ACCOUNTS_FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const label = arg("label");
  if (!label) {
    console.error('❌ --label requis. Ex : npm run add-account -- --label "France" --proxy-server ... --proxy-user ... --proxy-pass ...');
    process.exit(1);
    return;
  }

  let sessionB64: string;
  try {
    sessionB64 = Buffer.from(await readFile(AUTH_FILE, "utf8")).toString("base64");
  } catch {
    console.error(`❌ ${AUTH_FILE} introuvable. Lance d'abord : npm run switch (puis connecte le compte ${label}).`);
    process.exit(1);
    return;
  }

  const proxyServer = arg("proxy-server");
  const proxy = proxyServer
    ? {
        server: proxyServer,
        ...(arg("proxy-user") ? { username: arg("proxy-user") as string } : {}),
        ...(arg("proxy-pass") ? { password: arg("proxy-pass") as string } : {}),
      }
    : undefined;

  if (!proxy) {
    console.warn("⚠️  Aucun proxy fourni pour ce compte (--proxy-server). Il sortira par l'IP du serveur.");
  }

  const id = arg("id") ?? slug(label);
  const account: Account = { id, label, sessionB64, ...(proxy ? { proxy } : {}) };

  const accounts = await readAccounts();
  const next = [...accounts.filter((a) => a.id !== id), account];

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ACCOUNTS_FILE, JSON.stringify(next, null, 2), "utf8");

  console.log(`✅ Compte « ${label} » (id: ${id}) enregistré.`);
  console.log(`   Comptes en préparation : ${next.map((a) => a.label).join(", ")}`);
  console.log("\nProchaine étape : ajoute d'autres comptes, puis lance `npm run build-accounts`.");
}

main().catch((error) => {
  console.error("Erreur :", error);
  process.exit(1);
});
