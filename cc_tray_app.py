"""
Claude Code Telemetry — Windows System Tray App
Sits in the notification area, collects token usage every 60s, sends to dashboard.
No console window. Settings via right-click -> Settings...
"""

import hashlib
import json
import pathlib
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("ERROR: pillow not installed. Run: pip install pillow")

try:
    import pystray
except ImportError:
    raise SystemExit("ERROR: pystray not installed. Run: pip install pystray")

try:
    import requests
except ImportError:
    raise SystemExit("ERROR: requests not installed. Run: pip install requests")

import tkinter as tk
from tkinter import messagebox, ttk

from cc_memdebug import rss_mb, top_allocations

CREATE_NO_WINDOW = 0x08000000  # Windows: don't flash a console window

# One Session for the whole process. requests.post()/requests.get() build a fresh
# Session — and therefore a fresh connection pool, adapters and TLS context — on
# every single call, which at a 60s poll (and far worse under retry storms) is
# both a per-cycle allocation churn and a steady stream of new TCP/TLS handshakes.
_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "cc-telemetry-tray"})
_SESSION.mount("https://", requests.adapters.HTTPAdapter(
    pool_connections=4, pool_maxsize=4, max_retries=0))
_SESSION.mount("http://", requests.adapters.HTTPAdapter(
    pool_connections=4, pool_maxsize=4, max_retries=0))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
APP_VERSION           = "3.2"
APP_NAME              = f"Claude Telemetry v{APP_VERSION}"   # for display in UI only
AUTOSTART_NAME        = "CCTelemetry"                        # stable autostart name, WITHOUT version
GITHUB_REPO           = "maico15/dashbord"
UPDATE_CHECK_INTERVAL = 3600  # seconds
HOME            = pathlib.Path.home()
CLAUDE_DIR      = HOME / ".claude"
CONFIG_PATH     = HOME / ".claude" / "telemetry_config.json"
BUFFER_PATH     = HOME / ".claude" / "telemetry_buffer.jsonl"
SEEN_PATH       = HOME / ".claude" / ".telemetry_seen"
LOG_PATH        = HOME / ".claude" / "telemetry_tray.log"
OFFSETS_PATH    = HOME / ".claude" / ".telemetry_offsets.json"
DROPS_PATH      = HOME / ".claude" / ".telemetry_drops.json"
SESSIONS_GLOB   = "projects/**/*.jsonl"
POLL_INTERVAL   = 60
MAX_SEEN        = 50_000
SEND_CHUNK      = 200
REQUEST_TIMEOUT = 15
DEFAULT_ENDPOINT = "https://dashbord-5u0i.onrender.com"

# Retry buffer: hard cap, drop-oldest. Without this an engineer who is offline
# (or misconfigured, so every POST 401s) grows telemetry_buffer.jsonl forever and
# reloads all of it into memory on every cycle.
MAX_BUFFER_EVENTS = 5_000

# Log rotation — the old _log() appended to a file that was never rotated.
LOG_MAX_BYTES     = 2 * 1024 * 1024
LOG_BACKUP_COUNT  = 3

# Self-watchdog (Part 3). Overridable via telemetry_config.json -> max_rss_mb.
DEFAULT_MAX_RSS_MB = 300
WATCHDOG_INTERVAL  = 60

# Browser tracking
BROWSER_POLL_INTERVAL = 30   # seconds
BROWSER_SESSION_GAP   = 120  # seconds of inactivity = new session

AI_TOOLS = {
    "chat.openai.com":        "chatgpt",
    "chatgpt.com":            "chatgpt",
    "claude.ai":              "claude",
    "anthropic.com":          "claude",
    "gemini.google.com":      "gemini",
    "aistudio.google.com":    "gemini",
    "ai.google.dev":          "gemini",
    "copilot.microsoft.com":  "copilot",
    "perplexity.ai":          "perplexity",
    "grok.com":               "grok",
    "meta.ai":                "meta",
    "chat.deepseek.com":      "deepseek",
    "lovable.dev":            "lovable",
    "lovable.app":            "lovable",
    "cursor.com":             "cursor",
    "cursor.sh":              "cursor",
    "v0.dev":                 "v0",
    "bolt.new":               "bolt",
    "replit.com":             "replit",
    "windsurf.ai":            "windsurf",
    "fireflies.ai":           "fireflies",
    "midjourney.com":         "midjourney",
    "runwayml.com":           "runway",
    "notion.so":              "notion",
}

# DNS cache patterns — primary detection method
AI_NETWORK_PATTERNS = {
    # ChatGPT / OpenAI
    "chat.openai.com":           "chatgpt",
    "chatgpt.com":               "chatgpt",
    "api.openai.com":            "chatgpt",
    "openai.com":                "chatgpt",
    # Claude / Anthropic
    "claude.ai":                 "claude",
    "api.anthropic.com":         "claude",
    "anthropic.com":             "claude",
    # Gemini / Google AI
    "gemini.google.com":         "gemini",
    "aistudio.google.com":       "gemini",
    "ai.google.dev":             "gemini",
    "bard.google.com":           "gemini",
    "makersuite.google.com":     "gemini",
    # Microsoft Copilot
    "copilot.microsoft.com":     "copilot",
    "copilot.cloud.microsoft":   "copilot",
    # Perplexity
    "perplexity.ai":             "perplexity",
    "www.perplexity.ai":         "perplexity",
    # Grok (xAI)
    "grok.com":                  "grok",
    "grok.x.ai":                 "grok",
    # Meta AI
    "meta.ai":                   "meta",
    "ai.meta.com":               "meta",
    # DeepSeek
    "chat.deepseek.com":         "deepseek",
    "deepseek.com":              "deepseek",
    # Lovable
    "lovable.dev":               "lovable",
    "app.lovable.dev":           "lovable",
    "lovable.app":               "lovable",
    # Cursor
    "cursor.com":                "cursor",
    "cursor.sh":                 "cursor",
    "api2.cursor.sh":            "cursor",
    # GitHub Copilot
    "copilot.github.com":        "github_copilot",
    # Bolt (StackBlitz)
    "bolt.new":                  "bolt",
    "stackblitz.com":            "bolt",
    # v0 (Vercel)
    "v0.dev":                    "v0",
    # Replit AI
    "replit.com":                "replit",
    "replit.ai":                 "replit",
    # Windsurf / Codeium
    "windsurf.ai":               "windsurf",
    "codeium.com":               "windsurf",
    # Midjourney
    "midjourney.com":            "midjourney",
    "www.midjourney.com":        "midjourney",
    # Runway
    "runwayml.com":              "runway",
    "app.runwayml.com":          "runway",
    # Fireflies
    "fireflies.ai":              "fireflies",
    "app.fireflies.ai":          "fireflies",
    # Notion AI
    "notion.so":                 "notion",
    "notion.com":                "notion",
}

# Window title keywords (case-insensitive) — fallback after DNS
AI_TITLE_KEYWORDS = [
    ("chatgpt",     "chatgpt"),
    ("openai",      "chatgpt"),
    ("claude",      "claude"),
    ("anthropic",   "claude"),
    ("gemini",      "gemini"),
    ("google ai",   "gemini"),
    ("ai studio",   "gemini"),
    ("copilot",     "copilot"),
    ("perplexity",  "perplexity"),
    ("grok",        "grok"),
    ("meta ai",     "meta"),
    ("deepseek",    "deepseek"),
    ("lovable",     "lovable"),
    ("cursor",      "cursor"),
    ("v0.dev",      "v0"),
    ("bolt.new",    "bolt"),
    ("replit",      "replit"),
    ("windsurf",    "windsurf"),
    ("midjourney",  "midjourney"),
    ("runway",      "runway"),
    ("fireflies",   "fireflies"),
    ("notion",      "notion"),
]

BROWSER_SESSIONS_PATH = HOME / ".claude" / "browser_sessions.jsonl"
BROWSER_BUFFER_PATH   = HOME / ".claude" / "browser_sessions_buffer.jsonl"
LOCK_FILE             = HOME / ".claude" / "telemetry_tray.lock"
HEARTBEAT_INTERVAL    = 600  # seconds

_REG_RUN = r"Software\Microsoft\Windows\CurrentVersion\Run"

_C_GRAY   = (120, 120, 120, 255)
_C_BLUE   = (59,  130, 246, 255)
_C_YELLOW = (234, 179,   8, 255)
_C_GREEN  = (34,  197,  94, 255)
_C_RED    = (239,  68,  68, 255)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_LOGGER = None
_LOGGER_LOCK = threading.Lock()


def _get_logger():
    """One RotatingFileHandler for the process lifetime.

    The previous _log() opened the log file on every call and never rotated it,
    so telemetry_tray.log grew without bound (6.1 MB on a live machine at the
    time this was fixed). The handler is built once and reused; nothing in the
    hot path creates handlers.
    """
    global _LOGGER
    if _LOGGER is not None:
        return _LOGGER
    with _LOGGER_LOCK:
        if _LOGGER is not None:
            return _LOGGER
        import logging
        from logging.handlers import RotatingFileHandler

        logger = logging.getLogger("cc_telemetry")
        logger.setLevel(logging.INFO)
        logger.propagate = False
        if not logger.handlers:
            try:
                LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
                handler = RotatingFileHandler(
                    LOG_PATH, maxBytes=LOG_MAX_BYTES,
                    backupCount=LOG_BACKUP_COUNT, encoding="utf-8",
                )
                handler.setFormatter(
                    logging.Formatter("%(asctime)s  %(message)s",
                                      datefmt="%Y-%m-%d %H:%M:%S")
                )
                logger.addHandler(handler)
            except Exception:
                logger.addHandler(logging.NullHandler())
        _LOGGER = logger
        return _LOGGER


def _log(msg: str) -> None:
    try:
        _get_logger().info(msg)
    except Exception:
        pass

def _check_for_update():
    """Check GitHub Releases for a newer version.
    Returns (latest_version, download_url) or None."""
    try:
        import urllib.request, json as _json
        url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
        req = urllib.request.Request(url, headers={"User-Agent": "cc-telemetry-tray"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = _json.load(r)
        latest = data.get("tag_name", "").lstrip("v")
        if not latest:
            return None
        try:
            from packaging.version import Version
            newer = Version(latest) > Version(APP_VERSION)
        except Exception:
            newer = latest > APP_VERSION
        if not newer:
            return None
        for asset in data.get("assets", []):
            if asset["name"].endswith(".exe"):
                return latest, asset["browser_download_url"]
        return None
    except Exception as e:
        _log(f"update check error: {e}")
        return None


def _ensure_single_instance() -> None:
    """Kill previous instance if running, then write our PID."""
    import os, subprocess as _sp

    if LOCK_FILE.exists():
        try:
            old_pid = int(LOCK_FILE.read_text().strip())
            if old_pid != os.getpid():
                try:
                    _sp.run(
                        ["taskkill", "/PID", str(old_pid), "/F"],
                        capture_output=True, timeout=5,
                    )
                    _log(f"killed previous instance pid={old_pid}")
                    time.sleep(1)
                except Exception as e:
                    _log(f"could not kill pid={old_pid}: {e}")
        except Exception:
            pass

    try:
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCK_FILE.write_text(str(os.getpid()))
        _log(f"instance started pid={os.getpid()}")
    except Exception as e:
        _log(f"lock file error: {e}")

# ---------------------------------------------------------------------------
# Seen / buffer helpers
# ---------------------------------------------------------------------------
def _load_seen() -> "OrderedDict":
    """Recently-seen event ids, oldest first.

    An OrderedDict used as an ordered set: a plain set has no order, so the old
    `list(seen)[-MAX_SEEN:]` trimmed an arbitrary subset rather than the newest
    ids — meaning old ids could survive while fresh ones were discarded, and
    already-sent events got resent. Insertion order makes the cap mean what it
    says and keeps the in-memory structure bounded at MAX_SEEN.
    """
    try:
        lines = SEEN_PATH.read_text(encoding="utf-8").splitlines()
        return OrderedDict.fromkeys(line for line in lines[-MAX_SEEN:] if line)
    except Exception:
        return OrderedDict()

def _remember_seen(seen: "OrderedDict", event_id: str) -> None:
    """Add an id and evict the oldest once over the cap."""
    if event_id in seen:
        seen.move_to_end(event_id)
    else:
        seen[event_id] = None
    while len(seen) > MAX_SEEN:
        seen.popitem(last=False)

def _save_seen(seen: "OrderedDict") -> None:
    try:
        SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEEN_PATH.write_text("\n".join(list(seen)[-MAX_SEEN:]), encoding="utf-8")
    except Exception:
        pass

def _load_offsets() -> dict:
    """Per-file byte offsets: {path: last_consumed_byte}."""
    try:
        data = json.loads(OFFSETS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_offsets(offsets: dict) -> None:
    try:
        OFFSETS_PATH.parent.mkdir(parents=True, exist_ok=True)
        OFFSETS_PATH.write_text(json.dumps(offsets), encoding="utf-8")
    except Exception:
        pass


def _load_buffer() -> list:
    try:
        events = []
        for line in BUFFER_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                events.append(json.loads(line))
        return events
    except Exception:
        return []

def _save_buffer(events: list) -> None:
    try:
        BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)
        BUFFER_PATH.write_text(
            "\n".join(json.dumps(e) for e in events), encoding="utf-8"
        )
    except Exception:
        pass

def _trim_buffer(events: list) -> tuple:
    """Cap the retry buffer, dropping oldest first. Returns (kept, dropped_count)."""
    if len(events) <= MAX_BUFFER_EVENTS:
        return events, 0
    dropped = len(events) - MAX_BUFFER_EVENTS
    return events[-MAX_BUFFER_EVENTS:], dropped


def _bump_drop_counter(n: int) -> int:
    """Persist a running count of events dropped from a full retry buffer."""
    if n <= 0:
        return 0
    total = n
    try:
        prev = json.loads(DROPS_PATH.read_text(encoding="utf-8")).get("dropped", 0)
        total = int(prev) + n
    except Exception:
        pass
    try:
        DROPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        DROPS_PATH.write_text(json.dumps({"dropped": total}), encoding="utf-8")
    except Exception:
        pass
    return total


def _read_drop_counter() -> int:
    try:
        return int(json.loads(DROPS_PATH.read_text(encoding="utf-8")).get("dropped", 0))
    except Exception:
        return 0


def _replace_buffer(events: list) -> None:
    """Write the retry buffer to exactly `events`, capped, counting drops.

    Replaces the old _append_buffer(). That appended failed events on top of a
    buffer that *already contained them* — _do_cycle() sent buffered+new, and on
    failure appended the whole batch back — so one offline cycle roughly doubled
    the buffer, and the next doubled it again. The file (and the list read from
    it every cycle) grew geometrically.
    """
    kept, dropped = _trim_buffer(events)
    if dropped:
        total = _bump_drop_counter(dropped)
        _log(f"buffer full ({MAX_BUFFER_EVENTS}) — dropped {dropped} oldest "
             f"event(s), {total} dropped since install")
    _save_buffer(kept)


def _load_browser_buffer() -> list:
    try:
        events = []
        for line in BROWSER_BUFFER_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                events.append(json.loads(line))
        return events
    except Exception:
        return []

def _save_browser_buffer(events: list) -> None:
    try:
        BROWSER_BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)
        BROWSER_BUFFER_PATH.write_text(
            "\n".join(json.dumps(e) for e in events), encoding="utf-8"
        )
    except Exception:
        pass

MAX_BROWSER_BUFFER = 500


def _append_browser_buffer(event: dict) -> None:
    existing = _load_browser_buffer()
    existing.append(event)
    if len(existing) > MAX_BROWSER_BUFFER:
        dropped = len(existing) - MAX_BROWSER_BUFFER
        existing = existing[-MAX_BROWSER_BUFFER:]
        total = _bump_drop_counter(dropped)
        _log(f"browser buffer full ({MAX_BROWSER_BUFFER}) — dropped {dropped} "
             f"oldest, {total} dropped since install")
    _save_browser_buffer(existing)

# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def _repo_from_cwd(cwd: str) -> str:
    try:
        return pathlib.PurePath(cwd).name
    except Exception:
        return "unknown"

def _event_id(session_id, timestamp, tokens_in, tokens_out) -> str:
    raw = f"{session_id}{timestamp}{tokens_in}{tokens_out}"
    return hashlib.sha256(raw.encode()).hexdigest()

def _read_new_lines(path: pathlib.Path, offsets: dict) -> tuple:
    """Yield only bytes appended since the last cycle. Returns (lines, new_offset).

    Session .jsonl files are append-only and reach tens of MB; the previous
    implementation read every byte of every file on every poll (21 MB across 15
    files on the machine this was profiled on, every 60s). Reading from a stored
    offset makes a steady-state cycle read approximately nothing.

    A short read (file replaced or truncated) resets the offset to 0 so the file
    is re-ingested rather than silently skipped; `seen` still dedupes the events.
    """
    key = str(path)
    start = offsets.get(key, 0)
    try:
        size = path.stat().st_size
    except OSError:
        return [], start
    if size < start:
        start = 0  # truncated or rotated
    if size == start:
        return [], start
    try:
        with open(path, "rb") as fh:      # context manager: handle always closed
            fh.seek(start)
            chunk = fh.read(size - start)
    except OSError as exc:
        _log(f"read error {path}: {exc}")
        return [], start
    # Only consume through the last complete line; a partially-written trailing
    # record is re-read next cycle rather than parsed as corrupt JSON.
    cut = chunk.rfind(b"\n")
    if cut == -1:
        return [], start
    consumed = chunk[: cut + 1]
    text = consumed.decode("utf-8", errors="replace")
    return text.splitlines(), start + len(consumed)


def _parse_file(path: pathlib.Path, seen: set, offsets: dict) -> list:
    events = []
    try:
        lines, new_offset = _read_new_lines(path, offsets)
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "assistant":
                continue
            msg = rec.get("message", {})
            usage = msg.get("usage", {})
            tokens_in  = usage.get("input_tokens", 0)
            tokens_out = usage.get("output_tokens", 0)
            cache_read  = usage.get("cache_read_input_tokens", 0)
            cache_write = usage.get("cache_creation_input_tokens", 0)
            model = msg.get("model", "")
            ts_raw = rec.get("timestamp", "")
            try:
                ts = datetime.fromisoformat(ts_raw.replace("+00:00", "")).replace(
                    tzinfo=timezone.utc).isoformat()
            except Exception:
                ts = datetime.now(timezone.utc).isoformat()
            session_id = rec.get("sessionId", path.stem)
            eid = _event_id(session_id, ts, tokens_in, tokens_out)
            if eid in seen:
                continue
            cwd = rec.get("cwd", "")
            events.append({
                "event_id":           eid,
                "session_id":         session_id,
                "timestamp":          ts,
                "tokens_input":       tokens_in,
                "tokens_output":      tokens_out,
                "tokens_cache_read":  cache_read,
                "tokens_cache_write": cache_write,
                "model":              model,
                "repo":               _repo_from_cwd(cwd),
            })
        offsets[str(path)] = new_offset
    except Exception as e:
        _log(f"parse error {path}: {e}")
    return events

def _collect(seen: set, offsets: dict) -> list:
    events = []
    live = set()
    for p in sorted(CLAUDE_DIR.glob(SESSIONS_GLOB)):
        live.add(str(p))
        events.extend(_parse_file(p, seen, offsets))
    # Prune offsets for files that no longer exist, so the map cannot grow
    # without bound as sessions are archived or deleted.
    for stale in [k for k in offsets if k not in live]:
        del offsets[stale]
    return events

# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------
def _send_chunk(events: list, cfg: dict) -> bool:
    try:
        url = cfg["endpoint"].rstrip("/") + "/api/telemetry/events"
        payload = {
            "engineer_id": cfg["engineer_id"],
            "secret":      cfg["secret"],
            "events":      events,
        }
        r = _SESSION.post(url, json=payload, timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            d = r.json()
            _log(f"sent {len(events)} -> accepted={d.get('accepted')} dup={d.get('duplicates')}")
            return True
        if r.status_code == 401:
            _log("ERROR 401: wrong secret")
            return False
        _log(f"server {r.status_code}")
        return False
    except Exception as e:
        _log(f"send error: {e}")
        return False

def _send_all(events: list, cfg: dict) -> tuple:
    """Returns (ok_count, failed_events).

    Deliberately does NOT touch the buffer file — the caller owns buffer state
    and rewrites it once with exactly what still needs retrying. Appending here
    (as this used to) double-counted events that came *from* the buffer.
    """
    if not events:
        return 0, []
    ok_count = 0
    failed = []
    for i in range(0, len(events), SEND_CHUNK):
        chunk = events[i:i + SEND_CHUNK]
        if _send_chunk(chunk, cfg):
            ok_count += len(chunk)
        else:
            failed.extend(chunk)
    return ok_count, failed

# ---------------------------------------------------------------------------
# Browser URL detection
# ---------------------------------------------------------------------------
def _get_ai_tool_from_network() -> str | None:
    """Detect active AI tool via socket DNS cache (primary) or PowerShell (fallback)."""
    import socket, subprocess

    # Method 1: socket.getaddrinfo — uses OS DNS cache, no PowerShell needed
    _AI_HOSTS = [
        ("chat.openai.com",       "chatgpt"),
        ("chatgpt.com",           "chatgpt"),
        ("claude.ai",             "claude"),
        ("api.anthropic.com",     "claude"),
        ("gemini.google.com",     "gemini"),
        ("aistudio.google.com",   "gemini"),
        ("ai.google.dev",         "gemini"),
        ("copilot.microsoft.com", "copilot"),
        ("perplexity.ai",         "perplexity"),
        ("grok.com",              "grok"),
        ("meta.ai",               "meta"),
        ("chat.deepseek.com",     "deepseek"),
        ("lovable.dev",           "lovable"),
        ("lovable.app",           "lovable"),
        ("cursor.com",            "cursor"),
        ("cursor.sh",             "cursor"),
        ("v0.dev",                "v0"),
        ("bolt.new",              "bolt"),
        ("replit.com",            "replit"),
        ("windsurf.ai",           "windsurf"),
        ("copilot.github.com",    "github_copilot"),
        ("fireflies.ai",          "fireflies"),
        ("midjourney.com",        "midjourney"),
        ("runwayml.com",          "runway"),
        ("notion.so",             "notion"),
    ]
    try:
        socket.setdefaulttimeout(0.3)
        for host, tool in _AI_HOSTS:
            try:
                if socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM):
                    _log(f"browser match (socket): {tool} via {host}")
                    return tool
            except (socket.gaierror, socket.timeout, OSError):
                pass
    except Exception as e:
        _log(f"socket detection error: {e}")
    finally:
        socket.setdefaulttimeout(None)

    # Method 2: PowerShell Get-DnsClientCache fallback
    try:
        ps = r"""
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { Get-DnsClientCache | Select-Object -ExpandProperty Entry } catch { Write-Output "" }
"""
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, timeout=10,
            creationflags=CREATE_NO_WINDOW,
        )
        try:
            output = r.stdout.decode("utf-8")
        except UnicodeDecodeError:
            output = r.stdout.decode("cp1251", errors="replace")

        dns_entries = output.strip().lower()
        if dns_entries:
            for pattern, tool in AI_NETWORK_PATTERNS.items():
                if pattern in dns_entries:
                    _log(f"browser match (dns): {tool}")
                    return tool
    except subprocess.TimeoutExpired:
        _log("dns cache check timed out — skipping")
    except Exception as e:
        _log(f"dns detection error: {e}")

    return None


def _get_active_browser_url() -> str | None:
    """Return AI tool name using DNS cache (primary) + window title (fallback)."""
    # Method 1: DNS cache — works regardless of window title language
    tool = _get_ai_tool_from_network()
    if tool:
        return tool

    # Method 2: window title fallback
    try:
        import subprocess

        ps = r"""
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    public static List<string> GetAll() {
        var list = new List<string>();
        EnumWindows((h, l) => {
            if (IsWindowVisible(h)) {
                var sb = new StringBuilder(512);
                GetWindowText(h, sb, 512);
                if (sb.Length > 0) list.Add(sb.ToString());
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@
[WinEnum]::GetAll() | ForEach-Object { Write-Output $_ }
"""
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, timeout=10,
            creationflags=CREATE_NO_WINDOW,
        )
        try:
            output = r.stdout.decode("utf-8")
        except UnicodeDecodeError:
            output = r.stdout.decode("cp1251", errors="replace")

        titles = output.strip().splitlines()
        browser_keywords = ["Google Chrome", "Microsoft Edge", "Firefox", "Firefox Developer Edition", "Opera", "Brave"]
        browser_titles = [t for t in titles if any(b in t for b in browser_keywords)]

        _log(f"browser scan: {len(titles)} windows, {len(browser_titles)} browser windows")

        for title in browser_titles:
            _log(f"browser window: {title[:100]}")
            t = title.lower()
            for domain, tool in AI_TOOLS.items():
                if domain in t:
                    _log(f"browser match (domain): {tool}")
                    return tool
            for keyword, tool_name in AI_TITLE_KEYWORDS:
                if keyword.lower() in t:
                    _log(f"browser match (keyword): {tool_name}")
                    return tool_name

        return None

    except Exception as e:
        _log(f"browser url error: {e}")
        return None


def _send_browser_session(cfg: dict, tool: str, duration_sec: int, date_str: str) -> bool:
    """Send browser AI tool session to dashboard. Buffer on failure."""
    event = {"tool": tool, "duration_sec": duration_sec, "date": date_str}
    try:
        url = cfg["endpoint"].rstrip("/") + "/api/telemetry/tool-sessions"
        payload = {"engineer_id": str(cfg["engineer_id"]), "secret": cfg["secret"], **event}
        r = _SESSION.post(url, json=payload, timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            _log(f"browser session sent: tool={tool} duration={duration_sec}s")
            _flush_browser_buffer(cfg)
            return True
        _log(f"browser session error {r.status_code} (engineer_id={cfg.get('engineer_id')}): {r.text[:120]}")
        _append_browser_buffer(event)
        return False
    except Exception as e:
        _log(f"browser session send error: {e} — buffering")
        _append_browser_buffer(event)
        return False


def _flush_browser_buffer(cfg: dict) -> None:
    """Try to send buffered browser sessions."""
    buffered = _load_browser_buffer()
    if not buffered:
        return
    remaining = []
    sent_count = 0
    url = cfg["endpoint"].rstrip("/") + "/api/telemetry/tool-sessions"
    for event in buffered:
        try:
            payload = {"engineer_id": str(cfg["engineer_id"]), "secret": cfg["secret"], **event}
            r = _SESSION.post(url, json=payload, timeout=REQUEST_TIMEOUT)
            if r.status_code == 200:
                sent_count += 1
                continue
        except Exception:
            pass
        # Track survivors by position rather than `e not in sent`, which was an
        # O(n^2) scan comparing dicts and mis-handled duplicate events.
        remaining.append(event)
    _save_browser_buffer(remaining)
    if sent_count:
        _log(f"browser buffer: flushed {sent_count}, remaining {len(remaining)}")


# ---------------------------------------------------------------------------
# Autostart
# ---------------------------------------------------------------------------
def _permanent_exe_path() -> str:
    """Return the canonical install path in LOCALAPPDATA."""
    import os
    return os.path.join(
        os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
        "CCTelemetry", "cc_telemetry_tray.exe"
    )

def _autostart_enabled() -> bool:
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN)
        winreg.QueryValueEx(key, AUTOSTART_NAME)
        winreg.CloseKey(key)
        return True
    except Exception:
        return False

def _cleanup_old_autostart_keys() -> None:
    """Remove old versioned registry keys (Claude Telemetry v2.4 etc)."""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN, 0, winreg.KEY_ALL_ACCESS)
        to_delete = []
        i = 0
        while True:
            try:
                name, _, _ = winreg.EnumValue(key, i)
                if name.startswith("Claude Telemetry v"):
                    to_delete.append(name)
                i += 1
            except OSError:
                break
        for name in to_delete:
            try:
                winreg.DeleteValue(key, name)
                _log(f"autostart: removed old key '{name}'")
            except Exception:
                pass
        winreg.CloseKey(key)
    except Exception:
        pass

def _set_autostart(enable: bool) -> None:
    try:
        import winreg, os, sys
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN,
                             0, winreg.KEY_ALL_ACCESS)
        if enable:
            # ALWAYS point to the permanent path, not the running exe
            if getattr(sys, "frozen", False):
                exe = _permanent_exe_path()
                # If not yet installed there (dev run), fall back to current
                if not os.path.exists(exe):
                    exe = sys.executable
                val = f'"{exe}"'
            else:
                exe = pathlib.Path(__file__).resolve()
                val = f'pythonw.exe "{exe}"'
            winreg.SetValueEx(key, AUTOSTART_NAME, 0, winreg.REG_SZ, val)
            _log(f"autostart enabled -> {val}")
        else:
            try:
                winreg.DeleteValue(key, AUTOSTART_NAME)
                _log("autostart disabled")
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception as e:
        _log(f"autostart registry error: {e}")

# ---------------------------------------------------------------------------
# Tray icon
# ---------------------------------------------------------------------------
def _make_icon(color=_C_BLUE) -> Image.Image:
    img  = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, 63, 63], radius=12, fill=(13, 16, 26, 255))
    pts = [(33, 8), (19, 33), (29, 33), (24, 56), (44, 27), (32, 27), (40, 8)]
    draw.polygon(pts, fill=color)
    return img

# ---------------------------------------------------------------------------
# Main app class
# ---------------------------------------------------------------------------
class TelemetryTrayApp:

    def __init__(self):
        self._stop                   = threading.Event()
        self._poll_thread            = None
        self._browser_thread         = None
        self._heartbeat_thread       = None
        self._update_thread          = None
        self._watchdog_thread        = None
        self._pending_update         = None
        self._settings_win           = None
        self._status                 = "Initializing..."
        self._browser_current_tool   = None
        self._browser_session_start  = None
        self._browser_last_seen      = None
        self._load_cfg()

    _memdebug_cfg_override = None

    def _load_cfg(self) -> dict:
        if self._memdebug_cfg_override is not None:
            return self._memdebug_cfg_override
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write_cfg(self, cfg: dict) -> None:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        _log(f"config saved: engineer_id={cfg.get('engineer_id')}")

    def _cfg_ok(self) -> bool:
        cfg = self._load_cfg()
        return bool(cfg.get("engineer_id") and cfg.get("secret"))

    def _verify_config(self) -> bool:
        cfg = self._load_cfg()
        if not cfg.get("engineer_id") or not cfg.get("secret"):
            return False
        try:
            url = cfg.get("endpoint", DEFAULT_ENDPOINT).rstrip("/") + "/api/telemetry/verify"
            r = _SESSION.post(url, json={
                "engineer_id": cfg["engineer_id"],
                "secret": cfg["secret"]
            }, timeout=5)
            return r.status_code == 200
        except Exception:
            # Network unavailable — trust local config
            return True

    def _start_poll(self) -> None:
        if self._poll_thread and self._poll_thread.is_alive():
            return
        self._stop.clear()
        self._poll_thread = threading.Thread(
            target=self._poll_loop, name="telem-poll", daemon=True)
        self._poll_thread.start()
        self._browser_thread = threading.Thread(
            target=self._browser_loop, name="browser-track", daemon=True)
        self._browser_thread.start()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, name="heartbeat", daemon=True)
        self._heartbeat_thread.start()
        self._update_thread = threading.Thread(
            target=self._update_loop, name="updater", daemon=True)
        self._update_thread.start()
        self._watchdog_thread = threading.Thread(
            target=self._watchdog_loop, name="watchdog", daemon=True)
        self._watchdog_thread.start()
        _log("polling started (claude code + browser + heartbeat + updater + watchdog)")

    def _stop_poll(self) -> None:
        self._stop.set()

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            self._do_cycle()
            self._stop.wait(POLL_INTERVAL)

    def _browser_loop(self) -> None:
        """Track time spent on AI tools in the active browser tab."""
        _tick = 0

        while not self._stop.is_set():
            try:
                _tick += 1
                cfg = self._load_cfg()
                if not cfg.get("engineer_id") or not cfg.get("secret"):
                    self._stop.wait(BROWSER_POLL_INTERVAL)
                    continue

                tool = _get_active_browser_url()
                now  = time.time()

                if tool:
                    _log(f"browser active: {tool}")
                if _tick % 10 == 0:
                    _log(f"browser tick {_tick}: tool={tool} current={self._browser_current_tool}")

                if tool:
                    if self._browser_current_tool != tool:
                        # Switched tool — flush previous session first
                        if self._browser_current_tool and self._browser_session_start and self._browser_last_seen:
                            dur = int(self._browser_last_seen - self._browser_session_start)
                            if dur >= 30:
                                date_str = datetime.fromtimestamp(self._browser_session_start).strftime("%Y-%m-%d")
                                _send_browser_session(cfg, self._browser_current_tool, dur, date_str)
                        self._browser_current_tool  = tool
                        self._browser_session_start = now
                        self._browser_last_seen     = now
                    else:
                        # Same tool — accumulate duration
                        self._browser_last_seen = now
                else:
                    # No AI tool active — flush if gap exceeded
                    if self._browser_current_tool and self._browser_session_start and self._browser_last_seen:
                        if now - self._browser_last_seen > BROWSER_SESSION_GAP:
                            dur = int(self._browser_last_seen - self._browser_session_start)
                            if dur >= 30:
                                date_str = datetime.fromtimestamp(self._browser_session_start).strftime("%Y-%m-%d")
                                _send_browser_session(cfg, self._browser_current_tool, dur, date_str)
                            self._browser_current_tool  = None
                            self._browser_session_start = None
                            self._browser_last_seen     = None
            except Exception as e:
                _log(f"browser loop error: {e}")

            self._stop.wait(BROWSER_POLL_INTERVAL)

    def _heartbeat_loop(self) -> None:
        """Ping backend every 10 minutes to prevent Render free plan sleep.

        Also reports this agent's RSS so fleet-wide memory is visible on the
        dashboard rather than only in each machine's local log.
        """
        while not self._stop.is_set():
            try:
                cfg = self._load_cfg()
                endpoint = cfg.get("endpoint", DEFAULT_ENDPOINT).rstrip("/")
                rss = rss_mb()
                sent = False
                if cfg.get("engineer_id") and cfg.get("secret"):
                    try:
                        r = _SESSION.post(
                            f"{endpoint}/api/telemetry/heartbeat",
                            json={
                                "engineer_id": str(cfg["engineer_id"]),
                                "secret":      cfg["secret"],
                                "version":     APP_VERSION,
                                "rss_mb":      round(rss, 1),
                                "buffered":    len(_load_buffer()),
                                "dropped":     _read_drop_counter(),
                            },
                            timeout=10,
                        )
                        if r.status_code == 200:
                            _log(f"heartbeat ok rss={rss:.1f}MB")
                            sent = True
                        elif r.status_code == 404:
                            # Backend not yet upgraded — fall back to the old ping
                            # so an older dashboard keeps being kept awake.
                            pass
                        else:
                            _log(f"heartbeat {r.status_code} rss={rss:.1f}MB")
                            sent = True
                    except Exception as exc:
                        _log(f"heartbeat post error: {exc}")
                if not sent:
                    r = _SESSION.get(f"{endpoint}/api/overview", timeout=10)
                    _log(f"heartbeat ping {r.status_code} rss={rss:.1f}MB")
            except Exception as e:
                _log(f"heartbeat error: {e}")
            self._stop.wait(HEARTBEAT_INTERVAL)

    def _watchdog_loop(self) -> None:
        """Guardrail: if RSS crosses the configured limit, flush state and log
        the top allocation sites so a runaway build can be diagnosed from the
        engineer's log alone, without asking them to reproduce."""
        warned = False
        while not self._stop.is_set():
            try:
                limit = float(self._load_cfg().get("max_rss_mb", DEFAULT_MAX_RSS_MB))
                rss = rss_mb()
                if rss and rss > limit:
                    if not warned:
                        _log(f"WATCHDOG: rss={rss:.1f}MB exceeds limit {limit:.0f}MB "
                             f"— flushing state")
                        for line in top_allocations(15) or ["(tracemalloc not tracing)"]:
                            _log(f"WATCHDOG   {line}")
                        warned = True
                    self._flush_state()
                elif rss and rss < limit * 0.8:
                    warned = False  # re-arm once back under 80% of the limit
            except Exception as exc:
                _log(f"watchdog error: {exc}")
            self._stop.wait(WATCHDOG_INTERVAL)

    def _flush_state(self) -> None:
        """Drop in-memory caches back to disk and release what we can."""
        import gc
        try:
            buffered = _load_buffer()
            _replace_buffer(buffered)   # re-applies the cap
            gc.collect()
            _log(f"WATCHDOG: state flushed, rss now {rss_mb():.1f}MB, "
                 f"buffer={len(_load_buffer())}, dropped={_read_drop_counter()}")
        except Exception as exc:
            _log(f"watchdog flush error: {exc}")

    def _update_loop(self) -> None:
        """Check for updates hourly, starting 30s after launch."""
        self._stop.wait(30)
        while not self._stop.is_set():
            result = _check_for_update()
            if result:
                latest_ver, download_url = result
                _log(f"update available: v{latest_ver}")
                self._set_status(f"Update v{latest_ver} available — right-click to install")
                self._pending_update = (latest_ver, download_url)
                try:
                    self._icon.update_menu()
                except Exception:
                    pass
            self._stop.wait(UPDATE_CHECK_INTERVAL)

    def _on_install_update(self, *_) -> None:
        import os, sys  # noqa: F401
        if not self._pending_update:
            return
        latest_ver, download_url = self._pending_update
        self._pending_update = None
        try:
            self._icon.update_menu()
        except Exception:
            pass
        threading.Thread(
            target=self._do_update,
            args=(download_url, latest_ver),
            daemon=True,
        ).start()

    def _do_update(self, download_url: str, latest_ver: str) -> None:
        """Download new exe and replace via batch script, then restart."""
        import os, sys, tempfile, urllib.request
        _log(f"downloading update v{latest_ver}...")
        self._set_status(f"Downloading v{latest_ver}...")
        try:
            tmp_dir = pathlib.Path(tempfile.gettempdir())
            new_exe = tmp_dir / "cc_telemetry_tray_new.exe"
            req = urllib.request.Request(
                download_url, headers={"User-Agent": "cc-telemetry-tray"}
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                new_exe.write_bytes(r.read())
            _log(f"downloaded to {new_exe}")

            current_exe = pathlib.Path(sys.executable).resolve()
            batch = tmp_dir / "cc_update.bat"
            batch.write_text(
                "@echo off\r\n"
                "timeout /t 2 /nobreak >nul\r\n"
                f"move /y \"{new_exe}\" \"{current_exe}\"\r\n"
                f"start \"\" \"{current_exe}\"\r\n"
                "del \"%~f0\"\r\n",
                encoding="ascii",
            )
            # Clean up old PyInstaller temp folders to prevent DLL conflicts
            import glob, shutil
            temp_dir = os.environ.get("TEMP", os.path.join(
                os.path.expanduser("~"), "AppData", "Local", "Temp"))
            for mei_dir in glob.glob(os.path.join(temp_dir, "_MEI*")):
                try:
                    shutil.rmtree(mei_dir, ignore_errors=True)
                    _log(f"update: cleaned {mei_dir}")
                except Exception:
                    pass

            import subprocess
            subprocess.Popen(
                ["cmd.exe", "/c", str(batch)],
                creationflags=CREATE_NO_WINDOW,
            )
            _log("updater launched, quitting...")
            self.root.after(0, self._on_quit)
        except Exception as e:
            _log(f"update failed: {e}")
            self._set_status(f"Update failed: {e}")

    def _do_cycle(self) -> None:
        cfg = self._load_cfg()
        if not cfg.get("engineer_id") or not cfg.get("secret"):
            self._set_status("No config — open Settings")
            return
        try:
            seen       = _load_seen()
            offsets    = _load_offsets()
            buffered   = _load_buffer()
            new_events = _collect(seen, offsets)
            all_events = buffered + new_events
            if not all_events:
                _save_offsets(offsets)
                ts = datetime.now().strftime("%H:%M")
                self._set_status(f"{ts}  +0 events sent")
                return

            count, failed = _send_all(all_events, cfg)

            # Only ids that actually reached the server are marked seen; a failed
            # event stays in the buffer and is retried, not silently dropped.
            failed_ids = {e.get("event_id") for e in failed}
            for e in new_events:
                if e["event_id"] not in failed_ids:
                    _remember_seen(seen, e["event_id"])
            _save_seen(seen)
            _save_offsets(offsets)

            # The buffer is rewritten to exactly what still needs retrying — on
            # success that is the empty list, i.e. a real drain.
            _replace_buffer(failed)

            ts = datetime.now().strftime("%H:%M")
            if failed:
                self._set_status(f"{ts}  buffered ({min(len(failed), MAX_BUFFER_EVENTS)})")
            else:
                self._set_status(f"{ts}  +{count} events sent")
        except Exception as e:
            _log(f"cycle error: {e}")
            self._set_status(f"Error: {e}")

    def _set_status(self, msg: str) -> None:
        self._status = msg
        try:
            self._icon.title = f"{APP_NAME}\n{msg}"
        except Exception:
            pass

    def _on_run_now(self, *_) -> None:
        threading.Thread(target=self._do_cycle, daemon=True).start()

    def _on_view_log(self, *_) -> None:
        self.root.after(0, self._open_log_viewer)

    def _open_log_viewer(self) -> None:
        from tkinter import scrolledtext

        win = tk.Toplevel(self.root)
        win.title("Telemetry Log")
        win.geometry("700x420")
        win.attributes("-topmost", True)

        bar = tk.Frame(win, pady=6, padx=10)
        bar.pack(fill="x")

        def refresh():
            txt.config(state="normal")
            txt.delete("1.0", "end")
            try:
                lines = LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
                txt.insert("end", "\n".join(lines[-200:]))
                txt.see("end")
            except FileNotFoundError:
                txt.insert("end", "No log file yet.\nRun Now to generate activity.")
            except Exception as e:
                txt.insert("end", f"Error reading log: {e}")
            txt.config(state="disabled")
            lbl_updated.config(text=f"Updated: {datetime.now().strftime('%H:%M:%S')}")

        def clear_log():
            try:
                LOG_PATH.write_text("", encoding="utf-8")
                refresh()
            except Exception:
                pass

        tk.Button(bar, text="⟳ Refresh", command=refresh,
                  font=("Segoe UI", 9)).pack(side="left", padx=(0, 8))
        tk.Button(bar, text="Clear", command=clear_log,
                  font=("Segoe UI", 9)).pack(side="left", padx=(0, 8))

        def copy_log():
            try:
                content = LOG_PATH.read_text(encoding="utf-8", errors="replace")
                win.clipboard_clear()
                win.clipboard_append(content)
                lbl_updated.config(text="Copied!")
                win.after(2000, lambda: lbl_updated.config(
                    text=f"Updated: {datetime.now().strftime('%H:%M:%S')}"))
            except Exception as e:
                lbl_updated.config(text=f"Copy error: {e}")

        tk.Button(bar, text="Copy", command=copy_log,
                  font=("Segoe UI", 9)).pack(side="left")
        lbl_updated = tk.Label(bar, text="", font=("Segoe UI", 9), fg="gray")
        lbl_updated.pack(side="right")

        txt = scrolledtext.ScrolledText(
            win, font=("Consolas", 9), state="disabled",
            wrap="none", bg="#1e1e1e", fg="#d4d4d4",
            insertbackground="white",
        )
        txt.pack(fill="both", expand=True, padx=6, pady=(0, 6))
        refresh()

    def _on_toggle_autostart(self, *_) -> None:
        _set_autostart(not _autostart_enabled())
        self._icon.update_menu()

    def _on_stats(self, *_) -> None:
        self.root.after(0, self._open_stats_window)

    def _open_stats_window(self) -> None:
        win = tk.Toplevel(self.root)
        win.title("My Stats")
        win.geometry("420x480")
        win.resizable(False, False)
        win.attributes("-topmost", True)
        win.configure(bg="#1e1e1e")

        BG      = "#1e1e1e"
        FG      = "#d4d4d4"
        FG_DIM  = "#888888"
        C_BLUE  = "#00cfff"
        C_PURPLE= "#7b61ff"
        C_GREEN = "#34c759"
        FONT    = ("Segoe UI", 9)
        FONT_B  = ("Segoe UI", 9, "bold")
        FONT_H  = ("Segoe UI", 10, "bold")

        # ── header bar ────────────────────────────────────────────────
        bar = tk.Frame(win, bg=BG, pady=6, padx=12)
        bar.pack(fill="x")

        lbl_name = tk.Label(bar, text="", font=FONT_H, bg=BG, fg=FG, anchor="w")
        lbl_name.pack(side="left")

        lbl_updated = tk.Label(bar, text="", font=FONT, bg=BG, fg=FG_DIM, anchor="e")
        lbl_updated.pack(side="right")

        # ── week label ────────────────────────────────────────────────
        lbl_week = tk.Label(win, text="", font=FONT, bg=BG, fg=FG_DIM, anchor="w", padx=12)
        lbl_week.pack(fill="x")

        # ── separator helper ─────────────────────────────────────────
        def sep():
            tk.Frame(win, bg="#333333", height=1).pack(fill="x", padx=12, pady=4)

        def section_label(text, color):
            tk.Label(win, text=text, font=FONT_B, bg=BG, fg=color, anchor="w", padx=12
                     ).pack(fill="x")

        def stat_row(label, var_ref):
            frm = tk.Frame(win, bg=BG, padx=20)
            frm.pack(fill="x")
            tk.Label(frm, text=label, font=FONT, bg=BG, fg=FG_DIM, width=14, anchor="w"
                     ).pack(side="left")
            lbl = tk.Label(frm, textvariable=var_ref, font=FONT, bg=BG, fg=FG, anchor="w")
            lbl.pack(side="left")
            return lbl

        # ── Claude Code section ───────────────────────────────────────
        sep()
        section_label("CLAUDE CODE", C_BLUE)

        v_today_cc   = tk.StringVar(value="—")
        v_week_cc    = tk.StringVar(value="—")
        v_sessions   = tk.StringVar(value="—")
        v_last_event = tk.StringVar(value="—")

        stat_row("Today:",       v_today_cc)
        stat_row("This week:",   v_week_cc)
        stat_row("Sessions:",    v_sessions)
        stat_row("Last event:",  v_last_event)

        # ── Browser AI section ───────────────────────────────────────
        sep()
        section_label("BROWSER AI", C_PURPLE)

        v_browser_today = tk.StringVar(value="—")
        v_browser_week  = tk.StringVar(value="—")

        stat_row("Today:",       v_browser_today)
        stat_row("Week top:",    v_browser_week)

        # ── Connection section ───────────────────────────────────────
        sep()
        section_label("CONNECTION", C_GREEN)

        v_last_sent = tk.StringVar(value="—")
        v_buffered  = tk.StringVar(value="—")
        v_status    = tk.StringVar(value="—")

        stat_row("Last sent:",   v_last_sent)
        stat_row("Buffered:",    v_buffered)
        lbl_status = stat_row("Status:",      v_status)

        # ── refresh button ────────────────────────────────────────────
        sep()
        btn_row = tk.Frame(win, bg=BG, pady=6)
        btn_row.pack()
        lbl_msg = tk.Label(btn_row, text="", font=FONT, bg=BG, fg=FG_DIM)
        lbl_msg.pack(side="left", padx=(0, 8))

        _after_id = [None]

        def _schedule_refresh():
            _after_id[0] = win.after(300000, refresh)

        def refresh():
            if _after_id[0]:
                win.after_cancel(_after_id[0])
                _after_id[0] = None

            lbl_msg.config(text="Loading...", fg=FG_DIM)
            win.update_idletasks()

            cfg = self._load_cfg()
            eng_id = cfg.get("engineer_id", "")
            secret = cfg.get("secret", "")
            endpoint = cfg.get("endpoint", DEFAULT_ENDPOINT).rstrip("/")

            # ── connection section (always from local files) ──────────
            last_sent_ts = None
            try:
                lines = LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
                for line in reversed(lines[-100:]):
                    if "sent 200" in line or "sent " in line and "-> accepted" in line:
                        parts = line.strip().split()
                        if len(parts) >= 2:
                            v_last_sent.set(parts[1])
                            try:
                                from datetime import datetime as _dt
                                last_sent_ts = _dt.strptime(parts[0] + " " + parts[1], "%Y-%m-%d %H:%M:%S")
                            except Exception:
                                pass
                        break
                else:
                    v_last_sent.set("Never")
            except Exception:
                v_last_sent.set("—")

            try:
                buf_lines = BUFFER_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
                count = sum(1 for ln in buf_lines if ln.strip())
                v_buffered.set(f"{count} events")
            except FileNotFoundError:
                v_buffered.set("0 events")
            except Exception:
                v_buffered.set("—")

            if last_sent_ts:
                from datetime import datetime as _dt2
                delta = (_dt2.now() - last_sent_ts).total_seconds()
                if delta < 300:
                    v_status.set("✅ Online")
                    lbl_status.config(fg=C_GREEN)
                else:
                    v_status.set("⚠️ Check connection")
                    lbl_status.config(fg="#ff9f0a")
            else:
                v_status.set("⚠️ Check connection")
                lbl_status.config(fg="#ff9f0a")

            # ── API call ──────────────────────────────────────────────
            if not eng_id or not secret:
                lbl_msg.config(text="Not configured — run onboarding first.", fg="#ff453a")
                _schedule_refresh()
                return

            try:
                url = f"{endpoint}/api/engineer/{eng_id}/stats?secret={secret}"
                r = _SESSION.get(url, timeout=10)
                if r.status_code == 401:
                    lbl_msg.config(text="Auth error — check secret.", fg="#ff453a")
                    _schedule_refresh()
                    return
                if r.status_code != 200:
                    lbl_msg.config(text=f"Server error {r.status_code}", fg="#ff453a")
                    _schedule_refresh()
                    return
                data = r.json()
            except Exception as e:
                lbl_msg.config(text=f"Unable to connect: {e}", fg="#ff9f0a")
                _schedule_refresh()
                return

            # ── populate header ───────────────────────────────────────
            lbl_name.config(text=data.get("name", ""))
            lbl_week.config(text=f"Week {data.get('week')} · {data.get('year')}")

            # ── Claude Code ───────────────────────────────────────────
            cc = data.get("claude_code", {})
            today_total = cc.get("today_tokens_input", 0) + cc.get("today_tokens_output", 0)
            week_total  = cc.get("week_tokens_input",  0) + cc.get("week_tokens_output",  0)
            v_today_cc.set(f"{today_total:,} tokens")
            v_week_cc.set(f"{week_total:,} tokens")
            v_sessions.set(str(cc.get("week_sessions", 0)))
            last_ev = cc.get("last_event_at")
            if last_ev:
                try:
                    v_last_event.set(last_ev[11:16])
                except Exception:
                    v_last_event.set(last_ev)
            else:
                v_last_event.set("none")

            # ── Browser AI ────────────────────────────────────────────
            browser = data.get("browser", {})
            today_b = browser.get("today", [])
            if today_b:
                parts = [f"{t['tool']:<12} {t['duration_sec'] // 60} min" for t in today_b]
                v_browser_today.set("  " + ",  ".join(parts))
            else:
                v_browser_today.set("No activity today")

            week_b = browser.get("week", [])
            if week_b:
                top = week_b[0]
                v_browser_week.set(f"{top['tool']}  {top['duration_sec'] // 60} min")
            else:
                v_browser_week.set("No activity")

            lbl_msg.config(text="", fg=FG_DIM)
            lbl_updated.config(text=f"Updated: {datetime.now().strftime('%H:%M:%S')}")
            _schedule_refresh()

        tk.Button(btn_row, text="⟳ Refresh", command=refresh,
                  font=FONT, bg="#2d2d2d", fg=FG, relief="flat", padx=8).pack(side="left")

        win.protocol("WM_DELETE_WINDOW", lambda: (
            win.after_cancel(_after_id[0]) if _after_id[0] else None,
            win.destroy()
        ))

        refresh()

    def _on_settings(self, *_) -> None:
        self.root.after(0, self._open_settings)

    def _flush_browser_session_on_exit(self) -> None:
        """Flush any active browser session before app shutdown."""
        try:
            tool  = self._browser_current_tool
            start = self._browser_session_start
            seen  = self._browser_last_seen
            if not tool or not start or not seen:
                return
            dur = int(seen - start)
            if dur < 30:
                _log(f"shutdown flush: session too short ({dur}s), skipping")
                return
            cfg = self._load_cfg()
            date_str = datetime.fromtimestamp(start).strftime("%Y-%m-%d")
            _log(f"shutdown flush: {tool} {dur}s on {date_str}")
            _send_browser_session(cfg, tool, dur, date_str)
            self._browser_current_tool  = None
            self._browser_session_start = None
            self._browser_last_seen     = None
        except Exception as e:
            _log(f"shutdown flush error: {e}")

    def _on_quit(self, *_) -> None:
        self._flush_browser_session_on_exit()
        try:
            if LOCK_FILE.exists():
                LOCK_FILE.unlink()
        except Exception:
            pass
        self._stop_poll()
        self._icon.stop()
        self.root.quit()

    def _uninstall(self) -> None:
        import os, sys, subprocess, winreg, shutil

        from tkinter import messagebox
        confirmed = messagebox.askyesno(
            "Uninstall CC Telemetry",
            "This will:\n\n"
            "• Remove autostart from Windows registry\n"
            "• Delete all local data and config files\n"
            "• Remove desktop shortcut\n"
            "• Delete the application\n\n"
            "Your data on the dashboard will be preserved.\n\n"
            "Are you sure you want to uninstall?"
        )
        if not confirmed:
            return

        _log("uninstall: started")

        try:
            self._flush_browser_session_on_exit()
        except Exception as e:
            _log(f"uninstall: flush error: {e}")

        try:
            _set_autostart(False)
            _log("uninstall: autostart removed")
        except Exception as e:
            _log(f"uninstall: autostart error: {e}")

        files_to_delete = [
            CONFIG_PATH,
            BUFFER_PATH,
            SEEN_PATH,
            BROWSER_BUFFER_PATH,
        ]
        for f in files_to_delete:
            try:
                import pathlib
                p = pathlib.Path(f)
                if p.exists():
                    p.unlink()
                    _log(f"uninstall: deleted {p.name}")
            except Exception as e:
                _log(f"uninstall: could not delete {f}: {e}")

        try:
            ps_desktop = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive",
                 "-ExecutionPolicy", "Bypass",
                 "-Command",
                 "[Environment]::GetFolderPath('Desktop')"],
                capture_output=True, timeout=5
            )
            if ps_desktop.returncode == 0:
                desktop = ps_desktop.stdout.decode(errors="ignore").strip()
                shortcut = os.path.join(desktop, "CC Telemetry.lnk")
                if os.path.exists(shortcut):
                    os.remove(shortcut)
                    _log("uninstall: desktop shortcut removed")
        except Exception as e:
            _log(f"uninstall: shortcut error: {e}")

        try:
            _log("uninstall: complete — goodbye")
            import time
            time.sleep(0.2)
            LOG_PATH.unlink(missing_ok=True)
        except Exception:
            pass

        try:
            if getattr(sys, "frozen", False):
                exe_path = sys.executable
            else:
                exe_path = os.path.abspath(sys.argv[0])

            bat_path = os.path.join(
                os.environ.get("TEMP", os.path.expanduser("~")),
                "cc_telemetry_uninstall.bat"
            )
            bat_content = (
                "@echo off\n"
                "timeout /t 3 /nobreak >nul\n"
                f"del /f /q \"{exe_path}\"\n"
                f"del /f /q \"{bat_path}\"\n"
            )
            with open(bat_path, "w") as bf:
                bf.write(bat_content)

            subprocess.Popen(
                ["cmd", "/c", bat_path],
                creationflags=subprocess.CREATE_NO_WINDOW,
                close_fds=True
            )
            _log("uninstall: self-delete scheduled")
        except Exception as e:
            _log(f"uninstall: self-delete error: {e}")

        self._on_quit()

    def _on_uninstall(self, *_) -> None:
        self.root.after(0, self._uninstall)

    def _open_onboarding(self) -> None:
        win = tk.Toplevel(self.root)
        win.title("Claude Telemetry — Registration")
        win.geometry("420x420")
        win.resizable(False, False)
        win.attributes("-topmost", True)
        win.protocol("WM_DELETE_WINDOW", win.destroy)

        tk.Label(win, text="Claude Telemetry",
                 font=("Segoe UI", 14, "bold")).pack(pady=(20, 2))
        tk.Label(win, text="Register to appear on the dashboard",
                 font=("Segoe UI", 10), fg="gray").pack(pady=(0, 12))

        frm = tk.Frame(win)
        frm.pack(fill="x", padx=24)

        def row(label_text, var):
            tk.Label(frm, text=label_text, font=("Segoe UI", 10),
                     anchor="w").pack(fill="x", pady=(8, 0))
            e = tk.Entry(frm, textvariable=var, font=("Segoe UI", 10))
            e.pack(fill="x", ipady=4)
            return e

        var_first = tk.StringVar()
        var_last  = tk.StringVar()
        var_email = tk.StringVar()
        var_dept  = tk.StringVar()

        row("First name:", var_first)
        row("Last name:", var_last)
        row("Email (company domain):", var_email)

        tk.Label(frm, text="Department:", font=("Segoe UI", 10),
                 anchor="w").pack(fill="x", pady=(8, 0))
        dept_combo = ttk.Combobox(frm, textvariable=var_dept,
                                  state="readonly", font=("Segoe UI", 10))
        dept_combo.pack(fill="x", ipady=4)

        lbl_status = tk.Label(win, text="", font=("Segoe UI", 9),
                              wraplength=370, fg="red")
        lbl_status.pack(pady=(8, 0))

        cfg      = self._load_cfg()
        endpoint = cfg.get("endpoint", DEFAULT_ENDPOINT)
        dept_map = {}

        def load_departments():
            try:
                import urllib.request
                url = f"{endpoint.rstrip('/')}/api/departments"
                with urllib.request.urlopen(url, timeout=6) as r:
                    depts = json.load(r)
                for d in depts:
                    dept_map[d["name"]] = d["id"]
                dept_combo["values"] = list(dept_map.keys())
                if dept_combo["values"]:
                    dept_combo.current(0)
            except Exception as e:
                lbl_status.config(text=f"Cannot load departments: {e}")

        win.after(100, load_departments)

        def do_register():
            lbl_status.config(text="", fg="red")
            first     = var_first.get().strip()
            last      = var_last.get().strip()
            email     = var_email.get().strip()
            dept_name = var_dept.get()

            if len(first) < 2:
                lbl_status.config(text="First name must be at least 2 characters.")
                return
            if len(last) < 2:
                lbl_status.config(text="Last name must be at least 2 characters.")
                return
            _allowed_domains = ("@homealliance.com", "@alliancevs.io", "@bigbrainmarketing.co")
            if not any(email.lower().endswith(d) for d in _allowed_domains):
                lbl_status.config(text="Email must be from an allowed company domain.")
                return
            if not dept_name or dept_name not in dept_map:
                lbl_status.config(text="Please select a department.")
                return

            dept_id = dept_map[dept_name]
            lbl_status.config(text="Registering...", fg="gray")
            btn_reg.config(state="disabled")

            def _call():
                import urllib.request, urllib.error
                payload = json.dumps({
                    "first_name":    first,
                    "last_name":     last,
                    "email":         email,
                    "department_id": dept_id,
                }).encode()
                url = f"{endpoint.rstrip('/')}/api/register-engineer"
                req = urllib.request.Request(
                    url, data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                try:
                    with urllib.request.urlopen(req, timeout=10) as r:
                        data = json.load(r)
                    cfg_new = self._load_cfg()
                    cfg_new["endpoint"]         = endpoint
                    cfg_new["engineer_id"]      = str(data["engineer_id"])
                    cfg_new["secret"]           = data["secret"]
                    cfg_new["registered_name"]  = data["name"]
                    cfg_new["registered_dept"]  = data["department"]
                    self._write_cfg(cfg_new)
                    _create_desktop_shortcut()
                    _set_autostart(True)
                    _log("registration: autostart enabled automatically")
                    win.after(0, lambda: _show_success(data))
                except urllib.error.HTTPError as e:
                    body = e.read().decode()
                    try:
                        msg = json.loads(body).get("detail", body)
                    except Exception:
                        msg = body
                    win.after(0, lambda m=msg: _show_error(m))
                except Exception as e:
                    win.after(0, lambda m=str(e): _show_error(m))

            threading.Thread(target=_call, daemon=True).start()

        def _show_success(data):
            for w in win.winfo_children():
                w.destroy()
            tk.Label(win, text="✓  You're on the dashboard!",
                     font=("Segoe UI", 14, "bold"), fg="#16a34a").pack(pady=(40, 10))
            info = (f"Name:       {data['name']}\n"
                    f"Department: {data['department']}\n"
                    f"ID:         {data['engineer_id']}")
            tk.Label(win, text=info, font=("Segoe UI", 11),
                     justify="left").pack(pady=8)
            tk.Label(win, text="Telemetry will start automatically.",
                     font=("Segoe UI", 10), fg="gray").pack(pady=4)
            tk.Button(win, text="Done", command=win.destroy,
                      font=("Segoe UI", 10), bg="#3b82f6", fg="white",
                      relief="flat", padx=20, pady=6).pack(pady=20)
            self._start_poll()

        def _show_error(msg):
            lbl_status.config(text=msg, fg="red")
            btn_reg.config(state="normal")

        btn_reg = tk.Button(win, text="Register", command=do_register,
                            font=("Segoe UI", 10, "bold"),
                            bg="#3b82f6", fg="white", relief="flat",
                            padx=20, pady=8, cursor="hand2")
        btn_reg.pack(pady=10)

    def _open_settings(self) -> None:
        if self._settings_win and self._settings_win.winfo_exists():
            self._settings_win.lift()
            return

        win = tk.Toplevel(self.root)
        win.title("Settings")
        win.geometry("460x430")
        win.resizable(False, False)
        win.attributes("-topmost", True)
        win.protocol("WM_DELETE_WINDOW", win.destroy)
        self._settings_win = win

        frm = tk.Frame(win, padx=16, pady=12)
        frm.pack(fill="both", expand=True)

        def row(label, default="", show=""):
            r = frm.grid_size()[1]
            tk.Label(frm, text=label, anchor="w", width=14).grid(
                row=r, column=0, sticky="w", pady=4)
            var = tk.StringVar(value=default)
            e = tk.Entry(frm, textvariable=var, show=show, width=38)
            e.grid(row=r, column=1, sticky="ew", pady=4)
            return var

        cfg = self._load_cfg()
        var_ep  = row("Endpoint:",    cfg.get("endpoint", DEFAULT_ENDPOINT))
        var_id  = row("Engineer ID:", cfg.get("engineer_id", ""))

        reg_name = cfg.get("registered_name", "")
        reg_dept = cfg.get("registered_dept", "")
        if reg_name:
            r = frm.grid_size()[1]
            tk.Label(frm, text=f"Registered as: {reg_name} ({reg_dept})",
                     fg="gray", font=("Segoe UI", 9)).grid(
                row=r, column=0, columnspan=2, sticky="w", pady=2)

        lbl_msg = tk.Label(frm, text="", fg="gray")
        lbl_msg.grid(row=frm.grid_size()[1], column=0, columnspan=2, pady=4)

        def save():
            if not var_id.get().strip().isdigit():
                lbl_msg.config(text="Engineer ID must be a number.", fg="red")
                return
            c = self._load_cfg()
            c["endpoint"]    = var_ep.get().strip()
            c["engineer_id"] = var_id.get().strip()
            self._write_cfg(c)
            lbl_msg.config(text="Saved!", fg="green")
            self._start_poll()

        def test():
            lbl_msg.config(text="Testing...", fg="gray")
            win.update()
            try:
                c = self._load_cfg()
                c["endpoint"]    = var_ep.get().strip()
                c["engineer_id"] = var_id.get().strip()
                seen = _load_seen()
                new_events = _collect(seen)
                count, err = _send_all(new_events, c)
                if err:
                    lbl_msg.config(text=err, fg="red")
                else:
                    lbl_msg.config(text=f"+{count} new events sent", fg="green")
            except Exception as e:
                lbl_msg.config(text=str(e), fg="red")

        def copy_config_path():
            win.clipboard_clear()
            win.clipboard_append(str(CONFIG_PATH))
            lbl_msg.config(text="Path copied! Transfer this file to another PC", fg="green")

        def create_shortcut():
            import os
            try:
                import subprocess
                ps_desktop = subprocess.run(
                    ["powershell", "-NoProfile", "-NonInteractive",
                     "-ExecutionPolicy", "Bypass",
                     "-Command", "[Environment]::GetFolderPath('Desktop')"],
                    capture_output=True, timeout=5
                )
                desktop = ps_desktop.stdout.decode(errors="ignore").strip()
                shortcut_path = os.path.join(desktop, "CC Telemetry.lnk")
                already_exists = os.path.exists(shortcut_path)
            except Exception:
                already_exists = False
                shortcut_path = None

            if already_exists:
                try:
                    os.remove(shortcut_path)
                except Exception:
                    pass

            _create_desktop_shortcut()

            try:
                if shortcut_path and os.path.exists(shortcut_path):
                    lbl_msg.config(
                        text="✓ Shortcut created on Desktop", fg="green")
                else:
                    lbl_msg.config(
                        text="⚠ Could not create shortcut", fg="orange")
            except Exception:
                lbl_msg.config(text="✓ Shortcut creation attempted", fg="green")

        btn_row = tk.Frame(frm)
        btn_row.grid(row=frm.grid_size()[1], column=0, columnspan=2, pady=8)
        tk.Button(btn_row, text="Save",             command=save,                    width=10).pack(side="left", padx=4)
        tk.Button(btn_row, text="Test",             command=test,                    width=10).pack(side="left", padx=4)
        tk.Button(btn_row, text="View Log",         command=self._open_log_viewer,   width=10).pack(side="left", padx=4)
        tk.Button(btn_row, text="Close",            command=win.destroy,             width=10).pack(side="left", padx=4)

        util_row = tk.Frame(frm)
        util_row.grid(row=frm.grid_size()[1], column=0, columnspan=2, pady=2)
        tk.Button(util_row, text="Copy config path", command=copy_config_path, width=20).pack(side="left", padx=4)
        tk.Button(
            util_row,
            text="Create Desktop Shortcut",
            command=create_shortcut,
            width=22
        ).pack(side="left", padx=4)

        # ── update section ────────────────────────────────────────────
        sep_r = frm.grid_size()[1]
        tk.Frame(frm, bg="#cccccc", height=1).grid(
            row=sep_r, column=0, columnspan=2, sticky="ew", pady=(10, 4))

        ver_row = tk.Frame(frm)
        ver_row.grid(row=frm.grid_size()[1], column=0, columnspan=2, sticky="w", pady=2)
        tk.Label(ver_row, text=f"Current version:  v{APP_VERSION}",
                 font=("Segoe UI", 9), fg="gray").pack(side="left", padx=(0, 12))

        btn_update = tk.Button(ver_row, text="Check for Update", font=("Segoe UI", 9), width=16)
        btn_update.pack(side="left")

        lbl_update_status = tk.Label(frm, text="", font=("Segoe UI", 9))
        lbl_update_status.grid(row=frm.grid_size()[1], column=0, columnspan=2, sticky="w", pady=2, padx=2)

        def do_install(latest_ver, download_url):
            from tkinter import messagebox
            if messagebox.askokcancel(
                "Install Update",
                f"Install v{latest_ver}?\n\nThe app will restart automatically.",
                parent=win,
            ):
                win.destroy()
                self._pending_update = (latest_ver, download_url)
                self._on_install_update()

        def check_update():
            btn_update.config(state="disabled", text="Checking...")
            lbl_update_status.config(text="")

            def _worker():
                try:
                    result = _check_for_update()
                except Exception:
                    result = "__error__"
                win.after(0, lambda: _on_result(result))

            def _on_result(result):
                if result == "__error__":
                    lbl_update_status.config(
                        text="⚠️ Could not check — no connection", fg="#ff4444")
                    btn_update.config(state="normal", text="Check for Update")
                elif result is None:
                    lbl_update_status.config(
                        text="✅ You have the latest version", fg="#34c759")
                    btn_update.config(state="normal", text="Check for Update")
                else:
                    latest_ver, download_url = result
                    lbl_update_status.config(
                        text=f"🆕 v{latest_ver} available — click Install",
                        fg="#ffa200")
                    btn_update.config(
                        state="normal",
                        text=f"Install v{latest_ver}",
                        command=lambda: do_install(latest_ver, download_url))

            threading.Thread(target=_worker, daemon=True).start()

        btn_update.config(command=check_update)

    def run(self) -> None:
        import atexit
        atexit.register(self._flush_browser_session_on_exit)
        _ensure_single_instance()
        self.root = tk.Tk()
        self.root.withdraw()

        menu = pystray.Menu(
            pystray.MenuItem("Run Now",           self._on_run_now),
            pystray.MenuItem("View Log",          self._on_view_log),
            pystray.MenuItem(
                lambda item: (
                    f"Install update v{self._pending_update[0]}"
                    if self._pending_update else "No updates"
                ),
                self._on_install_update,
                visible=lambda item: self._pending_update is not None,
            ),
            pystray.MenuItem("Start with Windows",
                             self._on_toggle_autostart,
                             checked=lambda item: _autostart_enabled()),
            pystray.MenuItem("My Stats",           self._on_stats),
            pystray.MenuItem("Settings…",          self._on_settings),
            pystray.MenuItem("Uninstall",         self._on_uninstall),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit",              self._on_quit),
        )

        self._icon = pystray.Icon(
            APP_NAME,
            _make_icon(_C_BLUE),
            APP_NAME,
            menu,
        )

        threading.Thread(target=self._icon.run, daemon=True).start()

        cfg = self._load_cfg()
        if not cfg.get("engineer_id") or not cfg.get("secret"):
            self.root.after(600, self._open_onboarding)
        elif not self._verify_config():
            _log("pre-flight verify failed (401) — re-running onboarding")
            self.root.after(600, self._open_onboarding)
        else:
            self._start_poll()

        self.root.mainloop()


def _ensure_permanent_exe() -> str:
    """
    If the exe is running from Downloads or Temp, copy it to
    %LOCALAPPDATA%\\CCTelemetry\\cc_telemetry_tray.exe
    Returns the permanent exe path (or current path if already permanent).
    """
    import os, sys, shutil
    if not getattr(sys, "frozen", False):
        return os.path.abspath(sys.argv[0])

    current = sys.executable
    install_dir = os.path.join(
        os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
        "CCTelemetry"
    )
    permanent = os.path.join(install_dir, "cc_telemetry_tray.exe")

    # Already in permanent location
    if os.path.abspath(current).lower() == os.path.abspath(permanent).lower():
        return permanent

    # Running from Downloads or Temp — copy to permanent location
    bad_paths = ["downloads", "temp", "tmp"]
    if any(p in current.lower() for p in bad_paths):
        try:
            os.makedirs(install_dir, exist_ok=True)
            shutil.copy2(current, permanent)
            _log(f"installed to {permanent}")
            # Relaunch from the permanent location and exit this instance
            import subprocess
            subprocess.Popen([permanent], close_fds=True)
            _log("relaunching from permanent path, exiting Downloads copy")
            raise SystemExit(0)
        except SystemExit:
            raise
        except Exception as e:
            _log(f"install copy error: {e}")
            return current
    else:
        return current

    return permanent


def _get_desktop_path() -> str:
    """Resolve Desktop path: PowerShell first, fallback to standard locations."""
    import os, subprocess
    # Method 1: PowerShell (handles OneDrive-relocated Desktop)
    try:
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass",
             "-Command", "[Environment]::GetFolderPath('Desktop')"],
            capture_output=True, timeout=5
        )
        if ps.returncode == 0:
            path = ps.stdout.decode(errors="ignore").strip()
            if path and os.path.isdir(path):
                return path
    except Exception:
        pass
    # Method 2: standard location
    candidate = os.path.join(os.path.expanduser("~"), "Desktop")
    if os.path.isdir(candidate):
        return candidate
    # Method 3: OneDrive standard
    onedrive = os.environ.get("OneDrive", "")
    if onedrive:
        candidate = os.path.join(onedrive, "Desktop")
        if os.path.isdir(candidate):
            return candidate
    return ""


def _create_desktop_shortcut() -> None:
    """Create a desktop shortcut to this exe on Windows via PowerShell."""
    import os, sys, subprocess, tempfile
    try:
        # Always point the shortcut at the permanent install path
        perm = _permanent_exe_path()
        if getattr(sys, "frozen", False) and os.path.exists(perm):
            exe_path = perm
        else:
            try:
                exe_path = _EXE_PATH
            except NameError:
                exe_path = sys.executable if getattr(sys, "frozen", False) \
                           else os.path.abspath(sys.argv[0])

        desktop = _get_desktop_path()
        if not desktop:
            _log("shortcut: could not resolve Desktop path (all methods failed)")
            return

        shortcut_path = os.path.join(desktop, "CC Telemetry.lnk")

        # Escape backslashes for PowerShell string
        exe_escaped = exe_path.replace("\\", "\\\\")
        dir_escaped = os.path.dirname(exe_path).replace("\\", "\\\\")
        sc_escaped  = shortcut_path.replace("\\", "\\\\")

        ps_lines = [
            "$ws = New-Object -ComObject WScript.Shell",
            f"$s = $ws.CreateShortcut([System.IO.Path]::GetFullPath('{sc_escaped}'))",
            f"$s.TargetPath = [System.IO.Path]::GetFullPath('{exe_escaped}')",
            f"$s.WorkingDirectory = [System.IO.Path]::GetFullPath('{dir_escaped}')",
            "$s.Description = 'Home Alliance Claude Code Telemetry'",
            f"$s.IconLocation = '{exe_escaped}'",
            "$s.Save()",
        ]
        ps_content = "\n".join(ps_lines)

        # Write PS script to temp file to avoid command-line encoding issues
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ps1", delete=False,
            encoding="utf-8"
        ) as tf:
            tf.write(ps_content)
            ps_file = tf.name

        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive",
                 "-ExecutionPolicy", "Bypass",
                 "-File", ps_file],
                capture_output=True, timeout=15
            )
        finally:
            try:
                os.remove(ps_file)
            except Exception:
                pass

        if result.returncode == 0:
            _log(f"shortcut: created at {shortcut_path}")
        else:
            err = result.stderr.decode("utf-8", errors="replace").strip()
            _log(f"shortcut PS error: {err}")

    except Exception as e:
        _log(f"shortcut error: {e}")


def _cleanup_mei_folders() -> None:
    """Remove stale PyInstaller _MEI temp folders on startup."""
    import os, sys, glob, shutil
    try:
        temp_dir = os.environ.get("TEMP", os.path.join(
            os.path.expanduser("~"), "AppData", "Local", "Temp"))
        current_mei = getattr(sys, "_MEIPASS", None)
        cleaned = 0
        for mei_dir in glob.glob(os.path.join(temp_dir, "_MEI*")):
            # Skip the folder belonging to THIS running instance
            if current_mei and os.path.abspath(mei_dir) == os.path.abspath(current_mei):
                continue
            try:
                shutil.rmtree(mei_dir, ignore_errors=True)
                cleaned += 1
            except Exception:
                pass
        if cleaned:
            _log(f"startup: cleaned {cleaned} stale _MEI folders")
    except Exception as e:
        _log(f"startup cleanup error: {e}")


def _run_memdebug(argv) -> None:
    """Headless collector loop with tracemalloc instrumentation.

    Runs the same _do_cycle() the tray runs, with no UI and no autostart/shortcut
    side effects, so a memory profile measures the collector rather than tkinter.

        python cc_tray_app.py --memdebug [--interval 1] [--snapshot-min 1]
                              [--minutes 15] [--offline]
    """
    import argparse

    from cc_memdebug import MemDebugger

    parser = argparse.ArgumentParser(prog="cc_tray_app --memdebug")
    parser.add_argument("--memdebug", action="store_true")
    parser.add_argument("--interval", type=float, default=1.0,
                        help="seconds between collector cycles (accelerated)")
    parser.add_argument("--snapshot-min", type=float, default=1.0,
                        help="minutes between tracemalloc snapshots")
    parser.add_argument("--minutes", type=float, default=15.0,
                        help="how long to run before exiting")
    parser.add_argument("--offline", action="store_true",
                        help="point at an unreachable endpoint to exercise the "
                             "buffer/retry path")
    parser.add_argument("--endpoint",
                        help="override the dashboard endpoint (use a local stub "
                             "so a profiling run never posts to production)")
    parser.add_argument("--state-dir",
                        help="redirect buffer/seen/log state into this directory "
                             "instead of ~/.claude, so a run cannot disturb the "
                             "real collector's state")
    parser.add_argument("--log", default=str(pathlib.Path.cwd() / "memdebug.log"))
    args = parser.parse_args(argv)

    if args.state_dir:
        global BUFFER_PATH, SEEN_PATH, LOG_PATH, OFFSETS_PATH, DROPS_PATH
        global BROWSER_SESSIONS_PATH, BROWSER_BUFFER_PATH
        state = pathlib.Path(args.state_dir)
        state.mkdir(parents=True, exist_ok=True)
        BUFFER_PATH           = state / "telemetry_buffer.jsonl"
        SEEN_PATH             = state / ".telemetry_seen"
        LOG_PATH              = state / "telemetry_tray.log"
        OFFSETS_PATH          = state / ".telemetry_offsets.json"
        DROPS_PATH            = state / ".telemetry_drops.json"
        BROWSER_SESSIONS_PATH = state / "browser_sessions.jsonl"
        BROWSER_BUFFER_PATH   = state / "browser_sessions_buffer.jsonl"

    app = TelemetryTrayApp()
    cfg = dict(app._load_cfg())
    if args.offline:
        # A port nothing listens on: every POST fails fast, exercising the
        # failure path without waiting on DNS or a 15s timeout.
        cfg["endpoint"] = "http://127.0.0.1:9"
    elif args.endpoint:
        cfg["endpoint"] = args.endpoint
    if args.offline or args.endpoint:
        app._memdebug_cfg_override = cfg

    dbg = MemDebugger(args.log, interval_sec=args.snapshot_min * 60, top=20)
    dbg.start()

    deadline = time.time() + args.minutes * 60
    cycles = 0
    try:
        while time.time() < deadline:
            app._do_cycle()
            cycles += 1
            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        dbg._write(f"=== ran {cycles} cycles at {args.interval}s interval ===")
        dbg.stop()
    print(f"memdebug: {cycles} cycles, report in {args.log}")


if __name__ == "__main__":
    import os as _os
    import sys as _sys

    if "--memdebug" in _sys.argv:
        _run_memdebug(_sys.argv[1:])
        _sys.exit(0)

    _EXE_PATH = _ensure_permanent_exe()
    _cleanup_mei_folders()
    _cleanup_old_autostart_keys()

    if _os.path.exists(CONFIG_PATH):
        # Registered user: self-heal shortcut and autostart on every launch
        try:
            _desk = _get_desktop_path()
            _sc = _os.path.join(_desk, "CC Telemetry.lnk") if _desk else None
            if _sc and not _os.path.exists(_sc):
                _create_desktop_shortcut()
        except Exception:
            _create_desktop_shortcut()

        # Re-assert autostart if user hasn't explicitly disabled it
        if not _autostart_enabled():
            _set_autostart(True)

    TelemetryTrayApp().run()
