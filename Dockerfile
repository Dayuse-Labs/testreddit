# Base Node ; on installe Chromium + ses dépendances système alignés sur la
# version de playwright résolue (évite les décalages de version d'image).
FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

# Chromium + libs système pour la version de playwright installée, et xvfb pour
# le mode "headed" virtuel (HEADLESS=false), moins détectable par l'anti-bot.
RUN npx playwright install --with-deps chromium \
  && apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
  && rm -rf /var/lib/apt/lists/*

COPY . .

ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Headless par défaut (fiable) ; xvfb seulement si HEADLESS=false (voir entrypoint).
# Invoqué via sh : pas de dépendance au bit exécutable.
CMD ["sh", "scripts/docker-entrypoint.sh"]
