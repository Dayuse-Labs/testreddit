import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Racine du projet (un niveau au-dessus de src/). */
export const ROOT_DIR = path.resolve(__dirname, "..");

/** Dossier de données local (gitignoré) : profil navigateur, historique, captures. */
export const DATA_DIR = path.join(ROOT_DIR, "data");

/** Profil Chromium persistant : contient la session Reddit après login manuel. */
export const PROFILE_DIR = path.join(DATA_DIR, "profile");

/** Fichier JSON de l'historique des réponses publiées. */
export const HISTORY_FILE = path.join(DATA_DIR, "history.json");

/** Fichier JSON de la file d'envois programmés. */
export const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");

/** Dossier des captures d'écran post-publication. */
export const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");

/** Fichier d'export de la session (cookies) pour un déploiement serveur. */
export const AUTH_FILE = path.join(DATA_DIR, "auth.json");

/** Dossier des fichiers statiques de l'UI. */
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");

/** Port du serveur web (Railway fournit PORT automatiquement). */
export const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

/**
 * Hôte d'écoute. En local : 127.0.0.1 (strictement local). Sur un serveur,
 * mettre HOST=0.0.0.0 pour être joignable (le Dockerfile le fait).
 */
export const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * Mode serveur : si REDDIT_SESSION_B64 est défini, la session est injectée via
 * cette variable d'environnement (base64 d'un storageState Playwright) au lieu
 * du profil persistant local. Permet de déployer sans interface graphique.
 */
export const REDDIT_SESSION_B64 = process.env.REDDIT_SESSION_B64 ?? "";
export const REMOTE_MODE = REDDIT_SESSION_B64.length > 0;

/**
 * Protection optionnelle par Basic Auth. Si APP_PASSWORD est défini, toutes les
 * routes l'exigent (indispensable dès que l'outil est exposé sur Internet).
 */
export const APP_USER = process.env.APP_USER ?? "admin";
export const APP_PASSWORD = process.env.APP_PASSWORD ?? "";

/**
 * Publication en headless par défaut (cf. plan). Mettre HEADLESS=false pour
 * repasser en fenêtre visible si Reddit bloque l'automatisation headless.
 */
export const HEADLESS = process.env.HEADLESS !== "false";

/**
 * User-Agent de navigateur réaliste, utilisé à la fois par Playwright et par
 * les requêtes .json passées via le contexte authentifié.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
