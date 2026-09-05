#!/usr/bin/env bash
# Startet die Fleet Console und öffnet sie im Browser.
#
# Läuft sie schon, wird nur das Fenster geöffnet — doppeltes Starten würde am
# belegten Port scheitern. Der Server läuft im Hintergrund weiter, auch wenn
# das aufrufende Fenster zugeht.
#
#   scripts/start.sh          starten bzw. öffnen
#   scripts/start.sh stop     beenden
#   scripts/start.sh status   nachsehen
#
# Der Programmstarter „Fleet Console.app" ruft genau dieses Skript auf.

set -uo pipefail

# Der Starter kann selbst aus einer Production-Session kommen.
unset NODE_ENV NEXT_RUNTIME

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4300
URL="http://localhost:$PORT"
LOG="$HOME/.claude/fleet-console/server.log"
PIDFILE="$HOME/.claude/fleet-console/server.pid"

mkdir -p "$(dirname "$LOG")"

# Node ist im Programm-Kontext nicht im PATH — Finder startet ohne Login-Shell.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

melde() { osascript -e "display notification \"$2\" with title \"Fleet Console\"" >/dev/null 2>&1; echo "$1 $2"; }

laeuft() {
  curl -fsS -o /dev/null --max-time 2 "$URL/api/meta" 2>/dev/null
}

case "${1:-start}" in
  stop)
    if [ -f "$PIDFILE" ]; then
      pid=$(cat "$PIDFILE")
      # Die ganze Prozessgruppe, sonst überlebt der Next-Server seinen Starter.
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
      sleep 1
      kill -9 -- "-$pid" 2>/dev/null
      rm -f "$PIDFILE"
    fi
    # Notnagel, falls die PID-Datei fehlt: was auch immer auf dem Port hört.
    lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null
    melde "·" "Beendet."
    exit 0
    ;;
  status)
    if laeuft; then echo "läuft auf $URL"; else echo "läuft nicht"; fi
    exit 0
    ;;
esac

if laeuft; then
  open "$URL"
  exit 0
fi

cd "$REPO" || { melde "!" "Ordner nicht gefunden: $REPO"; exit 1; }

if ! command -v npm >/dev/null 2>&1; then
  melde "!" "npm nicht gefunden. Node installieren oder PATH in scripts/start.sh ergänzen."
  exit 1
fi

[ -d node_modules ] || { melde "·" "Installiere Abhängigkeiten …"; npm install --silent >>"$LOG" 2>&1; }

# Neu bauen, wenn Quellen jünger sind als der letzte Build. Ohne das startet
# nach einer Codeänderung stillschweigend der alte Stand.
neuester_quellstand=$(find src messages package.json package-lock.json next.config.ts tsconfig.json -type f -newer .next/BUILD_ID 2>/dev/null | head -1)
if [ ! -f .next/BUILD_ID ] || [ -n "$neuester_quellstand" ]; then
  melde "·" "Baue die aktuelle Fassung …"
  if ! npm run build >>"$LOG" 2>&1; then
    melde "!" "Build fehlgeschlagen — siehe $LOG"
    open -a Console "$LOG" 2>/dev/null
    exit 1
  fi
fi

# setsid gibt es auf macOS nicht; eigene Prozessgruppe über setpgid des Subshell.
nohup npm run start >>"$LOG" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 40); do
  if laeuft; then
    open "$URL"
    melde "·" "Läuft auf $URL"
    exit 0
  fi
  sleep 0.5
done

melde "!" "Server ist nicht hochgekommen — siehe $LOG"
open -a Console "$LOG" 2>/dev/null
exit 1
