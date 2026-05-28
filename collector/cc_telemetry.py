"""
Claude Code telemetry collector.
Reads local Claude Code session files and ships token-usage metadata to the dashboard.
Never reads or transmits prompt text, response content, or code — only numeric token
counts, model name, session ID, timestamp, and repo name.

Usage:
  python cc_telemetry.py          # run once and exit
  python cc_telemetry.py --once   # same as above (explicit)
  python cc_telemetry.py --daemon # poll every 30 seconds indefinitely
"""

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

CLAUDE_DIR      = pathlib.Path.home() / ".claude"
CONFIG_PATH     = CLAUDE_DIR / "telemetry_config.json"
BUFFER_PATH     = CLAUDE_DIR / "telemetry_buffer.jsonl"
SEEN_PATH       = CLAUDE_DIR / ".telemetry_seen"
SESSIONS_GLOB   = "projects/*/sessions/*.jsonl"

MAX_SEEN        = 10_000
POLL_INTERVAL   = 30   # seconds
REQUEST_TIMEOUT = 10   # seconds

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config() -> dict:
    if not CONFIG_PATH.exists():
        print(
            f"\nTelemetry config not found at {CONFIG_PATH}\n"
            "Create it with the following content:\n"
            "{\n"
            '  "endpoint": "https://dashbord-5u0i.onrender.com",\n'
            '  "engineer_id": YOUR_ID,\n'
            '  "secret": "YOUR_TELEMETRY_SECRET"\n'
            "}\n"
            "Then re-run this script."
        )
        sys.exit(1)
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    for key in ("endpoint", "engineer_id", "secret"):
        if key not in cfg:
            print(f"ERROR: '{key}' missing from {CONFIG_PATH}")
            sys.exit(1)
    return cfg

# ---------------------------------------------------------------------------
# Seen-events tracker (last MAX_SEEN event_ids in a plain text file)
# ---------------------------------------------------------------------------

def load_seen() -> set:
    if not SEEN_PATH.exists():
        return set()
    try:
        lines = SEEN_PATH.read_text().splitlines()
        return set(lines[-MAX_SEEN:])
    except Exception:
        return set()


def save_seen(seen: set) -> None:
    SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    items = list(seen)[-MAX_SEEN:]
    SEEN_PATH.write_text("\n".join(items))

# ---------------------------------------------------------------------------
# Buffer (events that couldn't be sent)
# ---------------------------------------------------------------------------

def load_buffer() -> list:
    if not BUFFER_PATH.exists():
        return []
    events = []
    try:
        for line in BUFFER_PATH.read_text().splitlines():
            line = line.strip()
            if line:
                events.append(json.loads(line))
    except Exception:
        pass
    return events


def save_buffer(events: list) -> None:
    BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BUFFER_PATH, "w") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")


def append_buffer(events: list) -> None:
    BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BUFFER_PATH, "a") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")

# ---------------------------------------------------------------------------
# Repo detection
# ---------------------------------------------------------------------------

def detect_repo() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode == 0:
            return pathlib.Path(result.stdout.strip()).name
    except Exception:
        pass
    return "unknown"

# ---------------------------------------------------------------------------
# Event ID
# ---------------------------------------------------------------------------

def make_event_id(session_id: str, timestamp: str, tokens_in: int, tokens_out: int) -> str:
    raw = f"{session_id}|{timestamp}|{tokens_in}|{tokens_out}"
    return hashlib.sha256(raw.encode()).hexdigest()

# ---------------------------------------------------------------------------
# Session file parsing
# ---------------------------------------------------------------------------

def parse_session_file(path: pathlib.Path, seen: set) -> list:
    """
    Parse a Claude Code session JSONL file.
    Returns a list of telemetry event dicts (metadata only, no content).
    """
    events = []
    # Derive session_id from parent directory name or file stem
    session_id = path.parent.name or path.stem

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return events

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except Exception:
            continue

        # Accept records that carry a message with usage
        msg = record.get("message") or {}
        usage = msg.get("usage") or {}

        tokens_input  = int(usage.get("input_tokens", 0) or 0)
        tokens_output = int(usage.get("output_tokens", 0) or 0)
        cache_read    = int(usage.get("cache_read_input_tokens", 0) or 0)
        cache_write   = int(usage.get("cache_creation_input_tokens", 0) or 0)

        # Skip records with no token data
        if tokens_input == 0 and tokens_output == 0:
            continue

        model     = str(msg.get("model") or record.get("model") or "unknown")
        timestamp = str(record.get("timestamp") or "")
        if not timestamp:
            timestamp = datetime.now(timezone.utc).isoformat()

        # Normalise to ISO-8601 without microseconds
        try:
            ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            timestamp = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            pass

        sid = str(record.get("sessionId") or session_id)
        event_id = make_event_id(sid, timestamp, tokens_input, tokens_output)

        if event_id in seen:
            continue

        events.append({
            "event_id":           event_id,
            "session_id":         sid,
            "timestamp":          timestamp,
            "model":              model,
            "tokens_input":       tokens_input,
            "tokens_output":      tokens_output,
            "tokens_cache_read":  cache_read,
            "tokens_cache_write": cache_write,
            "repo":               None,  # filled in by caller
        })

    return events

# ---------------------------------------------------------------------------
# Collect all new events from ~/.claude/projects/*/sessions/*.jsonl
# ---------------------------------------------------------------------------

def collect_events(seen: set) -> list:
    if not CLAUDE_DIR.exists():
        return []
    repo = detect_repo()
    events = []
    for session_file in sorted(CLAUDE_DIR.glob(SESSIONS_GLOB)):
        new = parse_session_file(session_file, seen)
        for ev in new:
            ev["repo"] = repo
        events.extend(new)
    return events

# ---------------------------------------------------------------------------
# Send events to backend
# ---------------------------------------------------------------------------

def send_events(events: list, cfg: dict) -> bool:
    """
    Returns True if the request succeeded, False on network/server error.
    """
    if not events:
        return True
    endpoint = cfg["endpoint"].rstrip("/") + "/api/telemetry/events"
    payload = {
        "engineer_id": cfg["engineer_id"],
        "secret":      cfg["secret"],
        "events":      events,
    }
    try:
        resp = requests.post(endpoint, json=payload, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            result = resp.json()
            print(
                f"[telemetry] sent {len(events)} event(s) → "
                f"accepted={result.get('accepted', '?')} "
                f"duplicate={result.get('duplicate', '?')}"
            )
            return True
        elif resp.status_code == 401:
            print(f"[telemetry] ERROR 401: wrong secret — check {CONFIG_PATH}")
            return False
        else:
            print(f"[telemetry] server error {resp.status_code}: {resp.text[:200]}")
            return False
    except requests.exceptions.ConnectionError:
        print("[telemetry] connection failed — buffering events")
        return False
    except requests.exceptions.Timeout:
        print("[telemetry] request timed out — buffering events")
        return False
    except Exception as e:
        print(f"[telemetry] unexpected error: {e}")
        return False

# ---------------------------------------------------------------------------
# One collection + send cycle
# ---------------------------------------------------------------------------

def run_once(cfg: dict) -> None:
    seen = load_seen()

    # 1. Collect new events
    new_events = collect_events(seen)

    # 2. Prepend buffered events (retry unsent from previous run)
    buffered = load_buffer()
    all_events = buffered + new_events

    if not all_events:
        print("[telemetry] no new events")
        # Mark new as seen even if nothing to send
        for ev in new_events:
            seen.add(ev["event_id"])
        save_seen(seen)
        return

    # 3. Try to send
    success = send_events(all_events, cfg)

    if success:
        # Mark everything as seen and clear buffer
        for ev in all_events:
            seen.add(ev["event_id"])
        save_seen(seen)
        save_buffer([])
    else:
        # Mark only new events as seen (so we don't re-parse them next time),
        # but keep them in the buffer for retry.
        for ev in new_events:
            seen.add(ev["event_id"])
        save_seen(seen)
        append_buffer(new_events)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Claude Code telemetry collector")
    parser.add_argument(
        "--daemon", action="store_true",
        help="Run continuously, polling every 30 seconds",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="Run one collection cycle and exit (default behaviour)",
    )
    args = parser.parse_args()

    cfg = load_config()
    print(f"[telemetry] engineer_id={cfg['engineer_id']} endpoint={cfg['endpoint']}")

    if args.daemon:
        print(f"[telemetry] daemon mode — polling every {POLL_INTERVAL}s")
        while True:
            try:
                run_once(cfg)
            except Exception as e:
                print(f"[telemetry] cycle error: {e}")
            time.sleep(POLL_INTERVAL)
    else:
        run_once(cfg)


if __name__ == "__main__":
    main()


# INSTALL:
# 1. pip install requests
# 2. Create ~/.claude/telemetry_config.json:
#    {
#      "endpoint": "https://dashbord-5u0i.onrender.com",
#      "engineer_id": YOUR_ID_FROM_ADMIN_PANEL,
#      "secret": "TELEMETRY_SECRET_FROM_ENV"
#    }
# 3. Test once: python cc_telemetry.py --once
# 4. Add to crontab (runs every minute):
#    * * * * * /usr/bin/python3 /path/to/cc_telemetry.py >> ~/.claude/telemetry.log 2>&1
# 5. Or run as daemon:
#    nohup python cc_telemetry.py --daemon >> ~/.claude/telemetry.log 2>&1 &
