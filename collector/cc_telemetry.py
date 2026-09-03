"""
Claude Code telemetry collector.
Reads local Claude Code session files and ships token-usage metadata to the dashboard.
Never reads or transmits prompt text, response content, or code - only numeric token
counts, model name, session ID, timestamp, and repo name.

Usage:
  python cc_telemetry.py          # run once and exit
  python cc_telemetry.py --once   # same as above (explicit)
  python cc_telemetry.py --daemon # poll every 30 seconds indefinitely
  python cc_telemetry.py --reset  # forget local dedup/retry state, then run once
"""

import argparse
import hashlib
import json
import os
import pathlib
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

# On Windows, stdout defaults to the console code page (cp1251/cp1252/cp866,
# depending on locale), none of which can encode characters like U+2192. A print
# containing one raises UnicodeEncodeError, which the broad `except Exception` in
# the send path then caught and reported as a *send* failure -- so a machine whose
# only fault was its console locale buffered every event and shipped nothing.
# Messages below are ASCII-only; this makes any future slip harmless too.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")   # Python 3.7+
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

CLAUDE_DIR      = pathlib.Path.home() / ".claude"
CONFIG_PATH     = CLAUDE_DIR / "telemetry_config.json"
BUFFER_PATH     = CLAUDE_DIR / "telemetry_buffer.jsonl"
SEEN_PATH       = CLAUDE_DIR / ".telemetry_seen"
# Recursive glob — matches ALL session JSONL files:
#   legacy:   projects/*/sessions/<session-id>.jsonl
#   current:  projects/<project>/<session>/subagents/agent-*.jsonl
#   new:      projects/<project>/<session-id>.jsonl  (main conversation files)
# The parser skips non-assistant records, so extra files are harmless.
SESSIONS_GLOB   = "projects/**/*.jsonl"

MAX_SEEN        = 10_000
# The retry buffer is now also where a *partially* accounted batch is parked, so
# it can grow across consecutive bad responses. Cap it drop-oldest, the way the
# tray agent does, rather than letting a long server-side outage fill the disk.
MAX_BUFFER_EVENTS = 5_000
# Events per POST. `--reset` replays every session file on disk, which is tens of
# thousands of events on a long-lived machine -- one request that size blows past
# REQUEST_TIMEOUT and the whole replay fails. Re-sending is idempotent (the server
# dedups on event_id), so chunking costs nothing.
MAX_BATCH       = 500
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
    dropped = len(events) - MAX_BUFFER_EVENTS
    if dropped > 0:
        # Drop oldest: the newest events are the ones still worth reconciling.
        print(f"[telemetry] buffer over {MAX_BUFFER_EVENTS} - dropping {dropped} oldest event(s)")
        events = events[-MAX_BUFFER_EVENTS:]
    with open(BUFFER_PATH, "w") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")


def append_buffer(events: list) -> None:
    # Read-modify-write rather than a bare append, so the cap is actually enforced.
    save_buffer(load_buffer() + list(events))


def reset_state() -> None:
    """Delete the local dedup and retry state.

    Needed after a server-side failure that returned 200 while storing nothing:
    those events are recorded in .telemetry_seen, so the collector would never
    offer them again and the data would be lost locally too. Clearing the file
    makes the next run re-read every session file from scratch. Replaying is
    safe -- the server dedups on event_id and reports repeats as `duplicate`.
    """
    for path in (SEEN_PATH, BUFFER_PATH):
        try:
            if path.exists():
                path.unlink()
                print(f"[telemetry] reset: removed {path}")
            else:
                print(f"[telemetry] reset: {path} not present, nothing to remove")
        except Exception as e:
            print(f"[telemetry] reset: could not remove {path}: {e}")

# ---------------------------------------------------------------------------
# Repo detection — derived from the cwd field embedded in each record
# ---------------------------------------------------------------------------

def repo_from_cwd(cwd: str) -> str:
    """Return the final directory component of cwd (= repo/project name)."""
    if not cwd:
        return "unknown"
    return pathlib.Path(cwd).name or "unknown"

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
    Parse a Claude Code agent JSONL file.
    Only processes records where type=="assistant" - those are the only ones
    that carry message.usage token counts.
    Returns a list of telemetry event dicts (metadata only, no content).
    """
    events = []

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

        # Only assistant records carry usage data; skip everything else.
        if record.get("type") != "assistant":
            continue

        msg   = record.get("message") or {}
        usage = msg.get("usage") or {}

        tokens_input  = int(usage.get("input_tokens", 0) or 0)
        tokens_output = int(usage.get("output_tokens", 0) or 0)
        cache_read    = int(usage.get("cache_read_input_tokens", 0) or 0)
        cache_write   = int(usage.get("cache_creation_input_tokens", 0) or 0)

        if tokens_input == 0 and tokens_output == 0:
            continue

        model     = str(msg.get("model") or "unknown")
        timestamp = str(record.get("timestamp") or "")
        if not timestamp:
            timestamp = datetime.now(timezone.utc).isoformat()

        # Normalise to ISO-8601 without microseconds
        try:
            ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            timestamp = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            pass

        # sessionId is a top-level field in every record
        sid      = str(record.get("sessionId") or path.parts[-3] or path.stem)
        # repo is derived from the cwd field embedded in each record
        repo     = repo_from_cwd(str(record.get("cwd") or ""))
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
            "repo":               repo,
        })

    return events

# ---------------------------------------------------------------------------
# Collect all new events from ~/.claude/projects/**/agent-*.jsonl
# ---------------------------------------------------------------------------

def collect_events(seen: set) -> list:
    if not CLAUDE_DIR.exists():
        return []
    events = []
    files = sorted(CLAUDE_DIR.glob(SESSIONS_GLOB))
    print(f"[telemetry] found {len(files)} agent file(s) under {CLAUDE_DIR / 'projects'}")
    for session_file in files:
        new = parse_session_file(session_file, seen)
        events.extend(new)
    return events

# ---------------------------------------------------------------------------
# Send events to backend
# ---------------------------------------------------------------------------

def _send_batch(events: list, cfg: dict) -> bool:
    """POST one batch. Returns True only if the server both answered 200 *and*
    accounted for every event in the batch.

    A 200 is not on its own proof of storage. The server reports what it did with
    the batch -- `accepted` (stored), `duplicate` (already had it) and `skipped`
    (rejected outright) -- and those must add up to what we sent. When they do
    not, the difference was dropped somewhere on the server, so we treat the
    batch as unsent and keep it buffered. Retrying is harmless: the server dedups
    on event_id, so anything that did land comes back as `duplicate`.
    """
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
            accepted     = result.get("accepted")
            duplicate    = result.get("duplicate")
            skipped      = result.get("skipped", 0)
            daily_failed = result.get("daily_failed", 0)
            print(
                f"[telemetry] sent {len(events)} event(s) -> "
                f"accepted={accepted if accepted is not None else '?'} "
                f"duplicate={duplicate if duplicate is not None else '?'} "
                f"skipped={skipped} daily_failed={daily_failed}"
            )
            if daily_failed:
                # The ai_events rows are stored (they are the source of truth), but
                # the daily rollup is behind and needs a server-side reprocess.
                print(
                    f"[telemetry] WARNING: server failed {daily_failed} daily-aggregate "
                    "upsert(s) -- events are stored, the rollup needs reprocessing"
                )
            if not isinstance(accepted, int) or not isinstance(duplicate, int):
                # Older backend that does not report counts -- nothing to verify.
                return True
            if not isinstance(skipped, int):
                skipped = 0
            accounted = accepted + duplicate + skipped
            if accounted < len(events):
                print(
                    f"[telemetry] PARTIAL FAILURE: server accounted for only "
                    f"{accounted}/{len(events)} event(s) -- keeping the batch buffered"
                )
                return False
            return True
        elif resp.status_code == 401:
            print(f"[telemetry] ERROR 401: wrong secret - check {CONFIG_PATH}")
            return False
        else:
            print(f"[telemetry] server error {resp.status_code}: {resp.text[:200]}")
            return False
    except requests.exceptions.ConnectionError:
        print("[telemetry] connection failed - buffering events")
        return False
    except requests.exceptions.Timeout:
        print("[telemetry] request timed out - buffering events")
        return False
    except Exception as e:
        print(f"[telemetry] unexpected error: {e}")
        return False


def send_events(events: list, cfg: dict) -> bool:
    """Send every event in MAX_BATCH-sized chunks.

    Returns True only if every chunk was fully accounted for. On the first bad
    chunk we stop: the whole set stays buffered and is retried next cycle, where
    the chunks that did land are reported back as `duplicate`.
    """
    if not events:
        return True
    for i in range(0, len(events), MAX_BATCH):
        if not _send_batch(events[i:i + MAX_BATCH], cfg):
            return False
    return True

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
    parser.add_argument(
        "--reset", action="store_true",
        help="Delete .telemetry_seen and telemetry_buffer.jsonl, then run once. "
             "Use this to re-send events the server acknowledged but never stored.",
    )
    args = parser.parse_args()

    cfg = load_config()
    print(f"[telemetry] engineer_id={cfg['engineer_id']} endpoint={cfg['endpoint']}")

    if args.reset:
        # Reset, then fall through to the normal once/daemon flow: `--reset` alone
        # runs a single cycle (the default), and `--reset --daemon` replays
        # everything and then keeps polling, rather than silently ignoring
        # --daemon.
        reset_state()

    if args.daemon:
        print(f"[telemetry] daemon mode - polling every {POLL_INTERVAL}s")
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
# 3b. Re-send everything (after a server-side data-loss incident):
#     python cc_telemetry.py --reset
#     Clears ~/.claude/.telemetry_seen and ~/.claude/telemetry_buffer.jsonl,
#     then re-reads every session file. Safe to repeat -- the server dedups
#     on event_id, so replayed events come back as `duplicate`.
# 4. Add to crontab (runs every minute):
#    * * * * * /usr/bin/python3 /path/to/cc_telemetry.py >> ~/.claude/telemetry.log 2>&1
# 5. Or run as daemon:
#    nohup python cc_telemetry.py --daemon >> ~/.claude/telemetry.log 2>&1 &
