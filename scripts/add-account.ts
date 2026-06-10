import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ACCOUNTS_FILE, AUTH_FILE, DATA_DIR } from "../src/config.js";
import { accountsSchema, type Account } from "../src/schemas.js";

/**
 * Enregistre un compte (un par marché) dans data/accounts.local.json.
 *
 * Recommandé — reconnexion automatique par identifiants :
 *   npm run add-account -- --label "France" \
 *     --user MON_PSEUDO --pass MON_MDP [--totp SECRET_2FA] \
 *     --proxy-server http://gate.decodo.com:10003 \
 *     --proxy-user user-...-country-fr-session-fr1-sessionduration-1440 \
 *     --proxy-pass MDP_PROXY
 *
 * (Legacy) sans --user/--pass : utilise la session de data/auth.json.
 *
 * ⚠️ Le mot de passe passé en argument reste dans l'historique du terminal.
 *    Tu peux aussi éditer data/accounts.local.json à la main.
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
    console.error('❌ --label requis. Ex : npm run add-account -- --label "France" --user PSEUDO --pass MDP --proxy-server ... --proxy-user ... --proxy-pass ...');
    process.exit(1);
    return;
  }

  const user = arg("user");
  const pass = arg("pass");

  const base: Pick<Account, "id" | "label"> = { id: arg("id") ?? slug(label), label };
  let auth: Partial<Account> = {};

  if (user && pass) {
    auth = {
      credentials: { username: user, password: pass, ...(arg("totp") ? { totpSecret: arg("totp") as string } : {}) },
    };
  } else {
    // Legacy : session exportée
    try {
      auth = { sessionB64: Buffer.from(await readFile(AUTH_FILE, "utf8")).toString("base64") };
    } catch {
      console.error("❌ Fournis --user et --pass (recommandé), ou lance d'abord `npm run switch` pour une session.");
      process.exit(1);
      return;
    }
  }

  const proxyServer = arg("proxy-server");
  const proxy = proxyServer
    ? {
        server: proxyServer,
        ...(arg("proxy-user") ? { username: arg("proxy-user") as string } : {}),
        ...(arg("proxy-pass") ? { password: arg("proxy-pass") as string } : {}),
      }
    : undefined;
  if (!proxy) console.warn("⚠️  Aucun proxy fourni — ce compte sortira par l'IP du serveur.");

  const account: Account = { ...base, ...auth, ...(proxy ? { proxy } : {}) };

  const accounts = await readAccounts();
  const next = [...accounts.filter((a) => a.id !== account.id), account];
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ACCOUNTS_FILE, JSON.stringify(next, null, 2), "utf8");

  console.log(`✅ Compte « ${label} » (id: ${account.id}, ${user ? "identifiants" : "session"}) enregistré.`);
  console.log(`   Comptes : ${next.map((a) => a.label).join(", ")}`);
  console.log("\nEnsuite : `npm run build-accounts` puis colle ACCOUNTS_B64 dans Railway.");
}

main().catch((error) => {
  console.error("Erreur :", error);
  process.exit(1);
});
