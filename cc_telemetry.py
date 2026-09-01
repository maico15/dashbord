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
import sys
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

# One Session for the process: requests.post() builds a fresh Session, connection
# pool and TLS context on every call, which in --daemon mode is per-cycle churn.
_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "cc-telemetry"})
_SESSION.mount("https://", requests.adapters.HTTPAdapter(
    pool_connections=4, pool_maxsize=4, max_retries=0))
_SESSION.mount("http://", requests.adapters.HTTPAdapter(
    pool_connections=4, pool_maxsize=4, max_retries=0))

CLAUDE_DIR      = pathlib.Path.home() / ".claude"
CONFIG_PATH     = CLAUDE_DIR / "telemetry_config.json"
BUFFER_PATH     = CLAUDE_DIR / "telemetry_buffer.jsonl"
OFFSETS_PATH    = CLAUDE_DIR / ".telemetry_offsets.json"
DROPS_PATH      = CLAUDE_DIR / ".telemetry_drops.json"
MAX_BUFFER_EVENTS = 5_000
SEEN_PATH       = CLAUDE_DIR / ".telemetry_seen"
LOG_PATH        = CLAUDE_DIR / "telemetry.log"
SESSIONS_GLOB   = "projects/**/*.jsonl"

MAX_SEEN        = 50_000   # was 1_000_000: a full set of 64-char ids is ~64MB resident
POLL_INTERVAL   = 30
REQUEST_TIMEOUT = 10

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

def load_seen() -> "OrderedDict":
    """Recently-seen ids, oldest first — an OrderedDict used as an ordered set.

    A plain set has no order, so `list(seen)[-MAX_SEEN:]` kept an arbitrary
    subset rather than the newest ids: old ids survived while fresh ones were
    discarded, and already-sent events were re-sent.
    """
    if not SEEN_PATH.exists():
        return OrderedDict()
    try:
        lines = SEEN_PATH.read_text().splitlines()
        return OrderedDict.fromkeys(ln for ln in lines[-MAX_SEEN:] if ln)
    except Exception:
        return OrderedDict()

def remember_seen(seen: "OrderedDict", event_id: str) -> None:
    if event_id in seen:
        seen.move_to_end(event_id)
    else:
        seen[event_id] = None
    while len(seen) > MAX_SEEN:
        seen.popitem(last=False)

def save_seen(seen: "OrderedDict") -> None:
    SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEEN_PATH.write_text("\n".join(list(seen)[-MAX_SEEN:]))

# The buffer is loaded more than once per cycle (run_once, then again inside the
# append path), so a single oversized file would otherwise be billed to the drop
# counter once per read. Key on the file's identity so each distinct on-disk state
# is accounted exactly once per process; the counter feeds the heartbeat payload,
# where a doubled number reads as twice the data loss that actually occurred.
_OVERFLOW_REPORTED = set()


def _claim_overflow_report() -> bool:
    try:
        st = BUFFER_PATH.stat()
        key = (st.st_size, st.st_mtime_ns)
    except OSError:
        return True
    if key in _OVERFLOW_REPORTED:
        return False
    _OVERFLOW_REPORTED.add(key)
    return True

def load_buffer() -> list:
    """Tail of the retry buffer, bounded at MAX_BUFFER_EVENTS and deduped by id.

    The cap used to be applied only on the write path, so a buffer that had grown
    past it could never be recovered: read_text() on a 658 MB file (2.1M lines,
    24 distinct events once deduped) materialised the whole thing, splitlines()
    doubled it, then one dict per line — ~6 GB resident, and the process died
    inside the load before append_buffer()'s trim was ever reached. Streaming into
    a bounded deque keeps a poisoned file survivable, and deduping here means the
    next save_buffer() writes the collapsed set back out.
    """
    if not BUFFER_PATH.exists():
        return []

    window = deque(maxlen=MAX_BUFFER_EVENTS)
    scanned = 0
    try:
        with open(BUFFER_PATH, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:               # line at a time — never the whole file
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                if not isinstance(record, dict):
                    continue
                window.append(record)
                scanned += 1
    except Exception:
        pass

    deduped = OrderedDict()
    for record in window:
        deduped[record.get("event_id") or id(record)] = record
    events = list(deduped.values())

    overflow = scanned - len(window)
    if overflow > 0 and _claim_overflow_report():
        total = _bump_drop_counter(overflow)
        print(f"[telemetry] buffer oversized ({scanned} lines) — dropped {overflow} "
              f"oldest event(s), {total} dropped since install")
    collapsed = len(window) - len(events)
    if collapsed > 0:
        print(f"[telemetry] collapsed {collapsed} duplicate event(s) from buffer")
    return events

def save_buffer(events: list) -> None:
    BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BUFFER_PATH, "w") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")

def _bump_drop_counter(n: int) -> int:
    if n <= 0:
        return 0
    total = n
    try:
        total += int(json.loads(DROPS_PATH.read_text()).get("dropped", 0))
    except Exception:
        pass
    try:
        DROPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        DROPS_PATH.write_text(json.dumps({"dropped": total}))
    except Exception:
        pass
    return total


def append_buffer(events: list) -> None:
    """Append to the retry buffer, capped at MAX_BUFFER_EVENTS (drop oldest).

    Uncapped, an engineer who is offline or has a bad secret grows this file
    forever and reloads all of it into memory on every cycle.
    """
    existing = load_buffer()
    existing.extend(events)
    if len(existing) > MAX_BUFFER_EVENTS:
        dropped = len(existing) - MAX_BUFFER_EVENTS
        existing = existing[-MAX_BUFFER_EVENTS:]
        total = _bump_drop_counter(dropped)
        print(f"[telemetry] buffer full ({MAX_BUFFER_EVENTS}) — dropped {dropped} "
              f"oldest event(s), {total} dropped since install")
    save_buffer(existing)


def load_offsets() -> dict:
    try:
        data = json.loads(OFFSETS_PATH.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_offsets(offsets: dict) -> None:
    try:
        OFFSETS_PATH.parent.mkdir(parents=True, exist_ok=True)
        OFFSETS_PATH.write_text(json.dumps(offsets))
    except Exception:
        pass

def repo_from_cwd(cwd: str) -> str:
    if not cwd:
        return "unknown"
    return pathlib.Path(cwd).name or "unknown"

def make_event_id(session_id: str, timestamp: str, tokens_in: int, tokens_out: int) -> str:
    raw = f"{session_id}|{timestamp}|{tokens_in}|{tokens_out}"
    return hashlib.sha256(raw.encode()).hexdigest()

def read_new_lines(path: pathlib.Path, offsets: dict) -> tuple:
    """Only the bytes appended since last cycle. Returns (lines, new_offset).

    Session files are append-only and reach tens of MB; re-reading every byte of
    every file on every poll was the collector's dominant allocation.
    """
    key = str(path)
    start = offsets.get(key, 0)
    try:
        size = path.stat().st_size
    except OSError:
        return [], start
    if size < start:
        start = 0  # truncated or replaced
    if size == start:
        return [], start
    try:
        with open(path, "rb") as fh:
            fh.seek(start)
            chunk = fh.read(size - start)
    except OSError:
        return [], start
    cut = chunk.rfind(b"\n")
    if cut == -1:
        return [], start
    consumed = chunk[: cut + 1]
    return consumed.decode("utf-8", errors="replace").splitlines(), start + len(consumed)


def parse_session_file(path: pathlib.Path, seen: set, offsets: dict) -> list:
    events = []
    try:
        lines, new_offset = read_new_lines(path, offsets)
        offsets[str(path)] = new_offset
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

        try:
            ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            timestamp = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            pass

        sid      = str(record.get("sessionId") or path.parts[-3] or path.stem)
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

def collect_events(seen: set, offsets: dict) -> list:
    if not CLAUDE_DIR.exists():
        return []
    events = []
    files = sorted(CLAUDE_DIR.glob(SESSIONS_GLOB))
    print(f"[telemetry] found {len(files)} agent file(s) under {CLAUDE_DIR / 'projects'}")
    live = set()
    for session_file in files:
        live.add(str(session_file))
        events.extend(parse_session_file(session_file, seen, offsets))
    # Prune offsets for files that are gone so the map stays bounded.
    for stale in [k for k in offsets if k not in live]:
        del offsets[stale]
    return events

SEND_CHUNK = 500

def _send_chunk(events: list, cfg: dict) -> bool:
    endpoint = cfg["endpoint"].rstrip("/") + "/api/telemetry/events"
    payload = {
        "engineer_id": cfg["engineer_id"],
        "secret":      cfg["secret"],
        "events":      events,
    }
    try:
        resp = _SESSION.post(endpoint, json=payload, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            result = resp.json()
            print(
                f"[telemetry] sent {len(events)} event(s) ->"
                f" accepted={result.get('accepted', '?')}"
                f" duplicate={result.get('duplicate', '?')}"
            )
            return True
        elif resp.status_code == 401:
            print(f"[telemetry] ERROR 401: wrong secret - check {CONFIG_PATH}")
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

def send_events(events: list, cfg: dict) -> bool:
    if not events:
        return True
    for i in range(0, len(events), SEND_CHUNK):
        if not _send_chunk(events[i:i + SEND_CHUNK], cfg):
            return False
    return True

def run_once(cfg: dict) -> None:
    seen = load_seen()
    offsets = load_offsets()
    new_events = collect_events(seen, offsets)
    buffered = load_buffer()
    all_events = buffered + new_events

    if not all_events:
        print("[telemetry] no new events")
        for ev in new_events:
            remember_seen(seen, ev["event_id"])
        save_seen(seen)
        save_offsets(offsets)
        return

    success = send_events(all_events, cfg)

    # Order matters in both branches: persist buffer state BEFORE advancing
    # offsets. Offsets are what stop a file region being read again, so dying
    # between the two would lose events outright; this way the worst case is
    # re-reading a region, which `seen` dedupes.
    if success:
        save_buffer([])            # drained on success
        for ev in all_events:
            remember_seen(seen, ev["event_id"])
        save_seen(seen)
        save_offsets(offsets)
    else:
        append_buffer(new_events)  # capped, drop-oldest
        for ev in new_events:
            remember_seen(seen, ev["event_id"])
        save_seen(seen)
        save_offsets(offsets)

def _redirect_to_log_if_no_console() -> None:
    """When running via pythonw.exe (no console window), redirect stdout/stderr to log file.

    pythonw.exe sets sys.stdout to None (or a non-seekable dummy), so print()
    calls would silently fail or raise.  Redirecting to LOG_PATH lets the
    scheduled task produce output without showing a terminal window.
    Interactive runs (python.exe with a real TTY) are unaffected.
    """
    try:
        if sys.stdout is None or not hasattr(sys.stdout, 'fileno'):
            raise OSError
        sys.stdout.fileno()  # raises OSError if no real console (pythonw.exe)
    except OSError:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        log_file = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
        sys.stdout = log_file
        sys.stderr = log_file


def main():
    parser = argparse.ArgumentParser(description="Claude Code telemetry collector")
    parser.add_argument("--daemon", action="store_true", help="Run continuously, polling every 30 seconds")
    parser.add_argument("--once", action="store_true", help="Run one collection cycle and exit (default)")
    args = parser.parse_args()

    _redirect_to_log_if_no_console()

    cfg = load_config()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [telemetry] engineer_id={cfg['engineer_id']} endpoint={cfg['endpoint']}")

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
#    {"endpoint": "https://dashbord-5u0i.onrender.com", "engineer_id": YOUR_ID, "secret": "SECRET"}
# 3. python cc_telemetry.py --once
# 4. crontab: * * * * * /usr/bin/python3 ~/cc_telemetry.py >> ~/.claude/telemetry.log 2>&1
