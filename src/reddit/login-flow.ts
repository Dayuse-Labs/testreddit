import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { SCREENSHOTS_DIR } from "../config.js";
import { getLoggedInUser, getPage } from "./browser.js";
import type { Credentials } from "../schemas.js";

export type LoginResult = {
  ok: boolean;
  user?: string;
  error?: string;
  screenshotFile?: string;
  /** true = échec lié à l'IP/au réseau → réessayer avec une autre IP peut marcher. */
  retryable?: boolean;
};

// --- TOTP (RFC 6238, SHA1, 6 chiffres, pas de 30 s) --------------------------
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotp(secret: string, atSeconds: number): string {
  const key = base32Decode(secret);
  const counter = Math.floor(atSeconds / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

// --- Login automatisé --------------------------------------------------------
/**
 * Connecte automatiquement le compte en saisissant ses identifiants sur la page
 * de login Reddit (headless, via le proxy du contexte). Gère la 2FA par TOTP si
 * un secret est fourni. Échoue proprement en cas de CAPTCHA / 2FA SMS.
 */
export async function performLogin(
  context: BrowserContext,
  credentials: Credentials,
  nowSeconds: number,
): Promise<LoginResult> {
  const page = await getPage(context);

  try {
    await page.goto("https://www.reddit.com/login/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(3000);

    // Blocage réseau (IP du proxy flaggée) → réessayable avec une autre IP.
    const content = await page.content();
    if (/blocked by network security|bloqué par.*sécurité/i.test(content)) {
      return { ok: false, retryable: true, error: "IP bloquée par Reddit (network security)." };
    }

    const userField = page.locator('input[name="username"]').first();
    const formVisible = await userField
      .waitFor({ state: "visible", timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    if (!formVisible) {
      return { ok: false, retryable: true, error: "Formulaire de login indisponible (IP/charge ?)." };
    }
    await userField.fill(credentials.username);
    const passwordField = page.locator('input[name="password"]').first();
    await passwordField.fill(credentials.password);
    await submitForm(page, passwordField);

    // Attend connexion / 2FA / échec.
    const deadline = Date.now() + 25000;
    let twoFADone = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);

      const user = await getLoggedInUser(context).catch(() => null);
      if (user) return { ok: true, user };

      // Champ de code 2FA présent ? (saisie unique)
      if (!twoFADone && credentials.totpSecret) {
        const otp = page.locator('input[name="otp"], input[autocomplete="one-time-code"]').first();
        if (await otp.isVisible().catch(() => false)) {
          await otp.fill(generateTotp(credentials.totpSecret, nowSeconds));
          await submitForm(page, otp);
          twoFADone = true;
        }
      }
    }

    // Échec : capture pour diagnostic.
    const screenshotFile = await captureFailure(page, credentials.username);
    return {
      ok: false,
      error:
        "Connexion automatique impossible (identifiants, CAPTCHA, ou 2FA SMS ?). " +
        "Vérifie la capture de diagnostic.",
      ...(screenshotFile ? { screenshotFile } : {}),
    };
  } catch (error) {
    const screenshotFile = await captureFailure(page, credentials.username);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(screenshotFile ? { screenshotFile } : {}),
    };
  }
}

/**
 * Soumet le formulaire : Enter sur le champ (fiable pour les forms Reddit), avec
 * repli sur un bouton « Log in » / « Continue » si présent.
 */
async function submitForm(
  page: import("playwright").Page,
  field: import("playwright").Locator,
): Promise<void> {
  await field.press("Enter").catch(() => undefined);
  const button = page
    .getByRole("button", { name: /log ?in|connexion|se connecter|continue|continuer/i })
    .first();
  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => undefined);
  }
}

async function captureFailure(
  page: import("playwright").Page,
  username: string,
): Promise<string | undefined> {
  try {
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    const file = `login-fail-${username.replace(/[^a-z0-9]/gi, "_")}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, file) });
    return file;
  } catch {
    return undefined;
  }
}
