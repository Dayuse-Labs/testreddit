#!/bin/sh
set -e

# Pile « navigateur distant interactif » : écran virtuel + VNC + pont websocket.
# Permet de se connecter à Reddit (CAPTCHA inclus) directement depuis l'UI web.
if [ "$ENABLE_VNC" = "1" ]; then
  export DISPLAY="${DISPLAY:-:99}"
  echo "Démarrage pile VNC sur $DISPLAY…"
  Xvfb "$DISPLAY" -screen 0 1360x900x24 -nolisten tcp &
  sleep 1
  fluxbox >/tmp/fluxbox.log 2>&1 &
  x11vnc -display "$DISPLAY" -nopw -forever -shared -rfbport 5900 -bg -o /tmp/x11vnc.log
  websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
  echo "Pile VNC prête (Xvfb $DISPLAY, x11vnc :5900, websockify :6080 → /usr/share/novnc)."
fi

exec npm run start
