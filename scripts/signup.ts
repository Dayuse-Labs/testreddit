import {
  getEgressIp,
  getLoggedInUser,
  getPage,
  launchContextForAccount,
} from "../src/reddit/browser.js";
import {
  PROXY_ENABLED,
  PROXY_PASSWORD,
  PROXY_SERVER,
  PROXY_USERNAME,
} from "../src/config.js";
import type { Account } from "../src/schemas.js";

/**
 * Ouvre une fenêtre Chromium (anti-détection) SORTANT PAR LE PROXY US, sur la
 * page d'inscription Reddit. Tu crées le compte à la main avec email + mot de
 * passe (PAS « Continuer avec Google »). Le compte naît ainsi sur l'IP US.
 *
 *   npm run signup
 */
async function main(): Promise<void> {
  if (!PROXY_ENABLED) {
    console.error("❌ Aucun proxy configuré (.env PROXY_SERVER/USERNAME/PASSWORD). Requis pour sortir en US.");
    process.exit(1);
    return;
  }

  const account: Account = {
    id: "signup",
    label: "Signup",
    proxy: {
      server: PROXY_SERVER,
      ...(PROXY_USERNAME ? { username: PROXY_USERNAME } : {}),
      ...(PROXY_PASSWORD ? { password: PROXY_PASSWORD } : {}),
    },
  };

  console.log("Ouverture du navigateur via le proxy US…");
  const context = await launchContextForAccount(account, false); // headed (fenêtre visible)

  const ip = await getEgressIp(context).catch(() => null);
  console.log(`IP de sortie : ${ip ?? "inconnue"} (doit être une IP US résidentielle)`);

  const page = await getPage(context);
  await page.goto("https://www.reddit.com/register/", { waitUntil: "domcontentloaded" }).catch(() => undefined);

  console.log("\n➡️  Dans la fenêtre : crée le compte avec EMAIL + MOT DE PASSE.");
  console.log("    ⚠️  N'utilise PAS « Continuer avec Google » (il faut un mot de passe Reddit).");
  console.log("    Note bien le pseudo et le mot de passe choisis.\n");
  console.log("    Le script détecte la connexion automatiquement puis se ferme.\n");

  const deadline = Date.now() + 15 * 60 * 1000;
  let user: string | null = null;
  while (Date.now() < deadline) {
    user = await getLoggedInUser(context).catch(() => null);
    if (user) break;
    await page.waitForTimeout(4000);
  }

  if (user) {
    console.log(`\n✅ Compte créé / connecté : u/${user}`);
    console.log("\nEnregistre-le ensuite (sans relancer de login) :");
    console.log(`   npm run add-account -- --label "<marché>" --user ${user} --pass <le_mot_de_passe> \\`);
    console.log("     --proxy-server $PROXY_SERVER --proxy-user $PROXY_USERNAME --proxy-pass $PROXY_PASSWORD");
  } else {
    console.log("\n⚠️  Pas de connexion détectée (délai dépassé). Relance `npm run signup` si besoin.");
  }

  await context.close();
  process.exit(user ? 0 : 1);
}

main().catch((error) => {
  console.error("Erreur :", error);
  process.exit(1);
});
