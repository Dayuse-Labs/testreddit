import {
  getEgressIp,
  getLoggedInUser,
  getPage,
  launchContextForAccount,
} from "../src/reddit/browser.js";
import { performLogin } from "../src/reddit/login-flow.js";
import {
  PROXY_ENABLED,
  PROXY_PASSWORD,
  PROXY_SERVER,
  PROXY_USERNAME,
  REDDIT_PASSWORD,
  REDDIT_TOTP_SECRET,
  REDDIT_USERNAME,
} from "../src/config.js";
import type { Account } from "../src/schemas.js";

/**
 * Ouvre une VRAIE fenêtre (sur ta machine) sortant par l'IP US du compte, et
 * tente de se connecter automatiquement. La fenêtre reste ouverte ~30 min pour
 * que tu inspectes le compte à la main (commentaire visible ?, email à vérifier…).
 *
 *   npm run open
 */
async function main(): Promise<void> {
  const account: Account = {
    id: "inspect",
    label: "Inspect",
    ...(REDDIT_USERNAME && REDDIT_PASSWORD
      ? {
          credentials: {
            username: REDDIT_USERNAME,
            password: REDDIT_PASSWORD,
            ...(REDDIT_TOTP_SECRET ? { totpSecret: REDDIT_TOTP_SECRET } : {}),
          },
        }
      : {}),
    ...(PROXY_ENABLED
      ? {
          proxy: {
            server: PROXY_SERVER,
            ...(PROXY_USERNAME ? { username: PROXY_USERNAME } : {}),
            ...(PROXY_PASSWORD ? { password: PROXY_PASSWORD } : {}),
          },
        }
      : {}),
  };

  console.log("Ouverture d'une fenêtre via l'IP du compte…");
  const context = await launchContextForAccount(account, false); // headed (visible)

  const ip = await getEgressIp(context).catch(() => null);
  console.log(`IP de sortie : ${ip ?? "inconnue"}`);

  if (account.credentials) {
    console.log("Tentative de connexion automatique…");
    const r = await performLogin(context, account.credentials, Date.now() / 1000);
    console.log(r.ok ? `✅ Connecté : u/${r.user}` : `⚠️ Login auto KO (${r.error}). Connecte-toi à la main dans la fenêtre.`);
  } else {
    console.log("Pas d'identifiants en env : connecte-toi à la main dans la fenêtre.");
  }

  const page = await getPage(context);
  await page.goto("https://www.reddit.com/", { waitUntil: "domcontentloaded" }).catch(() => undefined);

  const user = await getLoggedInUser(context).catch(() => null);
  if (user) console.log(`\nConnecté en tant que u/${user}. Va voir ton profil / le post à inspecter.`);

  console.log("\n🔎 Fenêtre ouverte ~30 min. Inspecte le compte, puis ferme la fenêtre (ou Ctrl+C).");
  await page.waitForTimeout(30 * 60 * 1000).catch(() => undefined);

  await context.close().catch(() => undefined);
  process.exit(0);
}

main().catch((error) => {
  console.error("Erreur :", error);
  process.exit(1);
});
