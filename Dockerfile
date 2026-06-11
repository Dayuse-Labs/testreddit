# Base Node ; Chromium + dépendances + pile VNC (navigateur distant interactif).
FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

# Chromium + libs système, et la pile écran virtuel / VNC / noVNC :
# - xvfb : écran virtuel ; fluxbox : gestionnaire de fenêtres léger
# - x11vnc : serveur VNC sur le display ; websockify + novnc : pont + client web
RUN npx playwright install --with-deps chromium \
  && apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc fluxbox novnc websockify \
  && rm -rf /var/lib/apt/lists/*

COPY . .

ENV HOST=0.0.0.0
ENV NODE_ENV=production
# Mode headed sur l'écran virtuel + pile VNC active (login interactif depuis l'UI).
ENV HEADLESS=false
ENV ENABLE_VNC=1
ENV DISPLAY=:99

CMD ["sh", "scripts/docker-entrypoint.sh"]
