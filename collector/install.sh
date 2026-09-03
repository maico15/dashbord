#!/usr/bin/env bash
# Claude Code telemetry collector — interactive installer
# Supports: macOS, Linux

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECTOR="$SCRIPT_DIR/cc_telemetry.py"
CONFIG="$HOME/.claude/telemetry_config.json"
ENDPOINT="https://dashbord-5u0i.onrender.com"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Claude Code Telemetry Collector — Installer   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Detect Python ──────────────────────────────────────────────────────────────
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON="$cmd"
        break
    fi
done
if [ -z "$PYTHON" ]; then
    echo "ERROR: Python not found. Install Python 3.8+ and retry."
    exit 1
fi
echo "Python: $($PYTHON --version)"

# ── Install requests ───────────────────────────────────────────────────────────
echo "Installing requests..."
"$PYTHON" -m pip install requests --quiet

# ── Interactive config ─────────────────────────────────────────────────────────
echo ""
echo "You can find your engineer_id in the Admin panel → Team section."
read -rp "Enter your engineer_id (number): " ENGINEER_ID
if ! [[ "$ENGINEER_ID" =~ ^[0-9]+$ ]]; then
    echo "ERROR: engineer_id must be a number."
    exit 1
fi

echo ""
echo "The TELEMETRY_SECRET is set as an environment variable on the backend."
echo "Ask your team lead for this value."
read -rsp "Enter TELEMETRY_SECRET: " SECRET
echo ""
if [ -z "$SECRET" ]; then
    echo "ERROR: secret cannot be empty."
    exit 1
fi

# ── Write config ───────────────────────────────────────────────────────────────
mkdir -p "$HOME/.claude"
cat > "$CONFIG" <<EOF
{
  "endpoint": "$ENDPOINT",
  "engineer_id": $ENGINEER_ID,
  "secret": "$SECRET"
}
EOF
echo "Config written to $CONFIG"

# ── Test connection ────────────────────────────────────────────────────────────
echo ""
echo "Testing connection..."
if "$PYTHON" "$COLLECTOR" --once; then
    echo ""
    echo "✓ Connection successful!"
else
    echo ""
    echo "⚠ Test run exited with errors. Check the output above."
    echo "  You can still set up the crontab and retry later."
fi

# ── Crontab setup ─────────────────────────────────────────────────────────────
echo ""
read -rp "Add to crontab (runs every minute)? [y/N]: " ADD_CRON
if [[ "$ADD_CRON" =~ ^[Yy]$ ]]; then
    CRON_CMD="* * * * * $PYTHON $COLLECTOR >> $HOME/.claude/telemetry.log 2>&1"
    # Remove any existing entry for this collector, then add fresh
    (crontab -l 2>/dev/null | grep -v "cc_telemetry.py"; echo "$CRON_CMD") | crontab -
    echo "✓ Crontab entry added."
    echo "  Log file: $HOME/.claude/telemetry.log"
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Installation complete!                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "To run manually:  python $COLLECTOR --once"
echo "To run as daemon: nohup python $COLLECTOR --daemon >> ~/.claude/telemetry.log 2>&1 &"
echo "To re-send all:   python $COLLECTOR --reset"
echo "                  (clears ~/.claude/.telemetry_seen + telemetry_buffer.jsonl,"
echo "                   then re-reads every session file. Use this if the server"
echo "                   acknowledged events it never actually stored. Safe to"
echo "                   repeat - replays are deduped server-side by event_id.)"
echo "Config location:  $CONFIG"
echo ""
