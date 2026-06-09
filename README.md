# Outil de réponse Reddit (interne)

Petit outil web **local** pour publier et journaliser des réponses depuis un compte Reddit connecté, avec aperçu du fil ciblé pour relire l'orthographe avant envoi.

## Fonctionnement

- Le navigateur Playwright utilise un **profil persistant** (`data/profile/`) : on se connecte **une seule fois** à la main, puis les publications se font **en headless**.
- Donne une **URL** (post ou commentaire) + un **texte** → l'outil affiche le contexte du fil, puis publie la réponse via `old.reddit.com`.
- Chaque publication est journalisée dans `data/history.json` avec une capture d'écran.
- Tout est strictement local : serveur lié à `127.0.0.1`, aucune donnée envoyée à un tiers.

## Installation

```bash
npm install          # installe les dépendances + Chromium (postinstall)
# si besoin : npx playwright install chromium
```

## Utilisation

```bash
# 1. Connexion (une fois, serveur arrêté) : une fenêtre s'ouvre, connecte-toi
npm run login

# 2. Démarrage du serveur
npm run dev          # http://127.0.0.1:3000
```

Dans l'interface :
1. Colle l'URL et clique **Charger l'aperçu**.
2. Saisis la réponse, relis, coche **« J'ai relu »**, clique **Publier**.
3. Suis les publications dans **Historique**.

## Réglages

- `PORT` — port du serveur (défaut `3000`).
- `HEADLESS=false` — repasse en fenêtre visible si Reddit bloque le headless.

## Déploiement serveur (Railway) — phase de test

Sur un serveur il n'y a pas d'interface graphique : on ne peut pas se connecter à la main.
La session est donc **exportée en local** puis **injectée via une variable d'environnement**.

### 1. Exporter la session (en local)

```bash
npm run login
```

À la fin, le script affiche une longue valeur **base64** (et l'enregistre dans `data/auth.json`).
Copie cette valeur : c'est ta session connectée.

> ⚠️ Cette valeur contient tes cookies de session — traite-la comme un mot de passe,
> ne la commite jamais dans git.

### 2. Déployer sur Railway

1. Pousse ce dossier sur un dépôt git, puis crée un projet Railway depuis ce dépôt.
   Railway détecte le `Dockerfile` (image Playwright avec Chromium).
2. Dans **Variables**, ajoute :
   - `REDDIT_SESSION_B64` = la valeur base64 copiée à l'étape 1
   - `APP_PASSWORD` = un mot de passe (protège l'URL publique — **obligatoire**)
   - `APP_USER` = identifiant (optionnel, défaut `admin`)
3. Déploie. Ouvre l'URL fournie par Railway : le navigateur demande identifiant/mot de passe,
   puis l'outil démarre **déjà connecté**.

En mode serveur : le bouton « Changer de compte » disparaît (pour changer de compte,
refais l'étape 1 et mets à jour `REDDIT_SESSION_B64`), et le planificateur tourne en 24/7.

### Limites connues du mode serveur (à valider pendant la discovery)

- **IP de datacenter** : Reddit peut bloquer (403) ou invalider la session utilisée depuis
  une IP différente de celle du login. Si l'aperçu/la publication échoue, c'est la cause la plus probable.
- **Persistance** : sans volume Railway monté sur `data/`, l'historique et les envois programmés
  sont réinitialisés à chaque redéploiement (la session, elle, vient de l'env, donc elle persiste).
- **Expiration de session** : il faudra refaire `npm run login` régulièrement.

## Notes

- Le login (`npm run login`) et le serveur **local** ne peuvent pas tourner en même temps : Chromium verrouille le profil persistant.
- Usage à faible volume, chaque réponse relue puis publiée manuellement.
