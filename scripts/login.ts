import { readFile, rm, writeFile } from "node:fs/promises";
import { launchContext, getLoggedInUser, getPage } from "../src/reddit/browser.js";
import { AUTH_FILE, PROFILE_DIR } from "../src/config.js";

/**
 * Login manuel (serveur arrêté) :
 *   npm run login            connexion / réutilise la session existante
 *   npm run login -- --switch  efface d'abord la session pour changer de compte
 *
 * Ouvre une fenêtre Chromium sur la page de connexion Reddit. La session est
 * sauvegardée dans data/profile/ et réutilisée ensuite par le serveur.
 */

type StorageState = {
  cookies?: Array<{ domain?: string }>;
  origins?: Array<{ origin?: string }>;
};

/**
 * Restreint l'export aux seuls cookies/origines reddit.com. Évite de fuiter
 * d'autres sessions du navigateur (ex. Google si login via « Sign in with Google »).
 */
function scopeToReddit(state: StorageState): StorageState {
  const isReddit = (domain: string | undefined) =>
    typeof domain === "string" && domain.includes("reddit.com");
  return {
    cookies: (state.cookies ?? []).filter((cookie) => isReddit(cookie.domain)),
    origins: (state.origins ?? []).filter(
      (origin) => typeof origin.origin === "string" && origin.origin.includes("reddit.com"),
    ),
  };
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--switch") || process.argv.includes("--fresh");
  if (fresh) {
    await rm(PROFILE_DIR, { recursive: true, force: true });
    console.log("Session précédente effacée : tu peux te connecter à un autre compte.");
  }

  console.log("Ouverture du navigateur (fenêtre visible)…");
  const context = await launchContext(false);
  const page = await getPage(context);

  await page.goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded" });

  console.log("\n➡️  Connecte-toi au compte Reddit dans la fenêtre ouverte.");
  console.log("    Le script détecte automatiquement la connexion, puis ferme.\n");

  // Sonde l'état de connexion toutes les 3 s (jusqu'à 5 min).
  const deadline = Date.now() + 5 * 60 * 1000;
  let user: string | null = null;
  while (Date.now() < deadline) {
    user = await getLoggedInUser(context);
    if (user) break;
    await page.waitForTimeout(3000);
  }

  if (user) {
    console.log(`✅ Connecté en tant que u/${user}. Session enregistrée localement.`);

    // Exporte la session, restreinte à reddit.com, pour un déploiement serveur.
    await context.storageState({ path: AUTH_FILE });
    const full = JSON.parse(await readFile(AUTH_FILE, "utf8")) as StorageState;
    const scoped = scopeToReddit(full);
    await writeFile(AUTH_FILE, JSON.stringify(scoped, null, 2), "utf8");

    console.log(`\nSession (reddit.com uniquement) enregistrée dans ${AUTH_FILE}.`);
    console.log("Pour un déploiement serveur, génère la variable d'environnement avec :");
    console.log("   npm run export-session");
    console.log("⚠️  Ne colle JAMAIS cette valeur dans un chat/ticket : ce sont tes identifiants.");
  } else {
    console.log("⚠️  Aucune connexion détectée (délai dépassé). Relance `npm run login`.");
  }

  await context.close();
  process.exit(user ? 0 : 1);
}

main().catch((error) => {
  console.error("Erreur pendant le login :", error);
  process.exit(1);
});
