#!/bin/sh
set -e

# Mode headed (navigateur visible) via écran virtuel xvfb, uniquement si demandé.
# Par défaut : headless (rebrowser passe déjà la détection). Plus simple et fiable.
if [ "$HEADLESS" = "false" ]; then
  echo "Démarrage en mode headed (xvfb-run)…"
  exec xvfb-run -a npm run start
fi

echo "Démarrage en mode headless…"
exec npm run start
