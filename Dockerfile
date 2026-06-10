# Image officielle Playwright : Chromium + dépendances système préinstallés.
# La version doit rester alignée avec "playwright" dans package.json.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Installe les dépendances (y compris devDependencies : tsx sert à lancer le TS).
COPY package*.json ./
RUN npm ci --include=dev

COPY . .

# Écoute sur toutes les interfaces (Railway route le trafic vers ce port).
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Railway fournit PORT automatiquement ; le serveur le lit.
# xvfb-run fournit un écran virtuel → permet le mode "headed" (HEADLESS=false),
# moins détectable par l'anti-bot Reddit. Sans effet si HEADLESS=true.
CMD ["xvfb-run", "-a", "npm", "run", "start"]
