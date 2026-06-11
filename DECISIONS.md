# Journal de décisions — Outil Reddit Dayuse

Ce document trace le cheminement du projet, ce qu'on a appris, et pourquoi on a
choisi l'architecture actuelle. À lire avant de reprendre le projet.

## Objectif initial
Aider le(s) compte(s) Reddit d'entreprise (un par marché) à **répondre à des
posts/commentaires** avec un contenu relu (orthographe/qualité), et **monitorer**
ce qui est publié.

## Ce qu'on a construit puis exploré (automatisation)
1. **Publication via navigateur (Playwright)** depuis une session connectée, avec
   aperçu du fil, historique, programmation d'envois.
2. **Proxy résidentiel (Decodo)** par compte pour sortir en IP résidentielle
   (géolocalisée), avec **jeton de session neuf à chaque lancement** (fix des 502
   « ERR_TUNNEL_CONNECTION_FAILED » des sessions sticky périmées).
3. **Anti-détection** : `rebrowser-playwright` (corrige la fuite CDP
   `Runtime.enable`) + plugin stealth, saisie « humaine » caractère par caractère.
4. **Reconnexion automatique par identifiants** + 2FA TOTP + rotation d'IP.

## Ce qu'on a appris (les murs de Reddit)
Reddit **combat activement l'accès automatisé**, en profondeur :

- **`.json` non authentifié → 403** (datacenter ET résidentiel). Les lectures
  passent via le **HTML old.reddit + proxy**, ou en session authentifiée.
- **Détection d'automatisation au chargement du login** (« An error occurred,
  use a different browser ») = fuite CDP `Runtime.enable`. **Réglée** par
  rebrowser-playwright (vérifié : bannière supprimée).
- **Blocage réseau par IP** (« blocked by network security ») : certaines IP du
  pool sont flaggées → on tourne l'IP jusqu'à en trouver une propre (~2/3 OK).
- **Login automatisé intermittent** : même en passant la détection, la
  *soumission* des identifiants est souvent rejetée (« Une erreur est survenue
  lors de la connexion. Merci de réessayer ») — rate-limit / anti-abus.
- **Session injectée (`REDDIT_SESSION_B64`)** : marche, mais Reddit **invalide la
  session** (surtout si l'IP de création ≠ IP d'usage) → déconnexions répétées.
- **Comptes Google SSO** : pas de mot de passe Reddit → login par formulaire
  impossible.
- **Comptes neufs** : leur contenu est **auto-retiré** par l'automod des subs
  (karma/âge/email non vérifié), invisible aux autres (seuils privés, non lisibles).

### Verdict
Il **n'existe pas** de solution **gratuite, fiable et 100 % autonome** pour
publier en automatique sur Reddit via navigateur. Les outils qui « y arrivent »
(Zapier, n8n, PRAW, Reddly…) utilisent **l'API officielle (OAuth)** — désormais
soumise à **approbation manuelle** (Responsible Builder Policy, nov. 2025), à
l'issue incertaine pour du multi-compte de marque. Le seul « navigateur » fiable
passe par des **anti-détection payants** (Multilogin…), contre les CGU, avec
risque de **ban groupé** des comptes de marque.

## Décision : Version 4 — assistant, publication humaine
On arrête l'automatisation de la publication. L'outil devient un **poste de
travail multi-comptes** :
- **Choisir un compte** (marché).
- **Voir ce qui a été publié** avec ce compte (lecture de l'activité Reddit).
- **Recommandations** de posts/commentaires sur lesquels réagir (monitoring).
- **Préparer les réponses** (rédaction + relecture qualité), mises en file.
- **Un humain publie** ensuite manuellement (copie de la réponse + ouverture du
  post sur Reddit).

Avantages : **zéro mur technique** (pas de login auto), **zéro risque CGU**,
fiable, et ça couvre l'essentiel du besoin (présence de qualité multi-marchés).

### Ce qu'on garde / ce qu'on retire
- **Garde** : sélecteur de compte, proxy résidentiel (utile pour les *lectures*
  sans 403), historique, aperçu de fil, identité visuelle Dayuse, documentation.
- **Retire du flux principal** : login automatique, publication automatique,
  programmation d'envois auto. (Le code reste dans l'historique git si besoin.)

## Login Reddit : tout ce qu'on a essayé (et pourquoi ça échoue)

Objectif : se connecter au compte de façon automatique/fiable. Chronologie des tentatives :

| # | Approche | Résultat |
|---|----------|----------|
| 1 | Session exportée (`REDDIT_SESSION_B64`), créée en local | ✅ marche un temps, puis **Reddit invalide la session** (surtout IP création ≠ IP usage) |
| 2 | Login auto par identifiants, Playwright **headless** + stealth | ❌ « An error occurred / use a different browser » (détection CDP `Runtime.enable`) |
| 3 | + **rebrowser-playwright** (patch Runtime.enable) | ✅ page de login atteinte, mais ❌ **soumission bloquée** (CAPTCHA/anti-bot) |
| 4 | + saisie « humaine » (char par char) + clic réel | ❌ « Une erreur est survenue lors de la connexion » (anti-abus au submit) |
| 5 | + **proxy résidentiel** (Decodo) | ✅ lectures OK ; ❌ login toujours bloqué |
| 6 | Login **manuel** via **noVNC** (vrai humain dans le navigateur distant) | ❌ « Erreur du serveur. Réessaie plus tard » (throttle **compte**, pas que l'IP) |
| 7 | **API OAuth password grant** (script app) | ❌ **création d'app refusée par Reddit** (voir ci-dessous) |

### Pourquoi le rate-limit malgré une IP différente
Reddit throttle le login selon **plusieurs signaux**, surtout **le compte lui-même** (trop de
tentatives échouées) + le fingerprint navigateur. Changer d'IP ne réinitialise pas le throttle compte.

### Pourquoi tu ne peux pas créer d'app Reddit
Depuis le **crackdown API de nov. 2025**, Reddit exige une **pré-approbation pour TOUTES les apps**,
y compris les projets perso. La création est évaluée sur : **âge du compte, karma, email vérifié,
historique de publication**. Nos comptes de test (créés le jour même, ~1 karma, sans historique) ne
remplissent **aucun** critère → création refusée (message renvoyant à la Responsible Builder Policy).
Un compte ancien, actif et avec du karma aurait plus de chances — mais pour du multi-compte de marque,
l'approbation reste incertaine.

### Conclusion
**Il n'existe pas de login Reddit automatique, fiable et gratuit pour ce cas** — c'est volontaire
(anti-bot/anti-multi-compte). Le **seul** endroit où le login passe : le **navigateur réel de
l'utilisateur** (IP résidentielle, vrai humain, pas de CAPTCHA bloquant).

### Solution retenue : injection de session depuis l'extension
On réutilise ce qui marche. L'extension `testtest` (déjà connectée à Reddit dans le vrai navigateur)
lit les cookies de session (`chrome.cookies`, y compris `reddit_session` httpOnly) et les **POST à
l'outil** (`/api/session`). L'outil **injecte** cette session (`data/sessions.json`, prioritaire sur
credentials/sessionB64) → lecture **et** publication possibles. Quand la session expire → **1 clic**
dans l'extension pour la rafraîchir. Semi-manuel, mais c'est le **maximum atteignable**.

## Stack / déploiement
- Node + TypeScript, Fastify, Playwright (lectures via old.reddit + proxy).
- Railway (Dockerfile, headless), protégé par Basic Auth (`APP_PASSWORD`).
- Comptes configurés via `ACCOUNTS_B64` (un par marché, proxy dédié).
