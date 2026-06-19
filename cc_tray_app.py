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

CREATE_NO_WINDOW = 0x08000000  # Windows: don't flash a console window

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
APP_VERSION     = "2.1"
APP_NAME        = f"Claude Telemetry v{APP_VERSION}"
HOME            = pathlib.Path.home()
CLAUDE_DIR      = HOME / ".claude"
CONFIG_PATH     = HOME / ".claude" / "telemetry_config.json"
BUFFER_PATH     = HOME / ".claude" / "telemetry_buffer.jsonl"
SEEN_PATH       = HOME / ".claude" / ".telemetry_seen"
LOG_PATH        = HOME / ".claude" / "telemetry_tray.log"
SESSIONS_GLOB   = "projects/**/*.jsonl"
POLL_INTERVAL   = 60
MAX_SEEN        = 50_000
SEND_CHUNK      = 200
REQUEST_TIMEOUT = 15
DEFAULT_ENDPOINT = "https://dashbord-5u0i.onrender.com"

# Browser tracking
BROWSER_POLL_INTERVAL = 30   # seconds
BROWSER_SESSION_GAP   = 120  # seconds of inactivity = new session

AI_TOOLS = {
    "claude.ai":             "claude",
    "chat.openai.com":       "chatgpt",
    "chatgpt.com":           "chatgpt",
    "lovable.dev":           "lovable",
    "app.lovable.dev":       "lovable",
    "gemini.google.com":     "gemini",
    "copilot.microsoft.com": "copilot",
}

# DNS cache patterns — primary detection method
AI_NETWORK_PATTERNS = {
    "openai.com":            "chatgpt",
    "chatgpt.com":           "chatgpt",
    "claude.ai":             "claude",
    "anthropic.com":         "claude",
    "lovable.dev":           "lovable",
    "gemini.google.com":     "gemini",
    "bard.google.com":       "gemini",
    "copilot.microsoft.com": "copilot",
    "perplexity.ai":         "perplexity",
}

# Window title keywords (case-insensitive) — fallback after DNS
AI_TITLE_KEYWORDS = [
    ("chatgpt",    "chatgpt"),
    ("openai",     "chatgpt"),
    ("claude",     "claude"),
    ("lovable",    "lovable"),
    ("gemini",     "gemini"),
    ("copilot",    "copilot"),
    ("perplexity", "perplexity"),
    ("cursor",     "cursor"),
    ("v0.dev",     "v0"),
    ("bolt.new",   "bolt"),
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
def _log(msg: str) -> None:
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{ts}  {msg}\n")
    except Exception:
        pass

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
def _load_seen() -> set:
    try:
        lines = SEEN_PATH.read_text(encoding="utf-8").splitlines()
        return set(lines[-MAX_SEEN:])
    except Exception:
        return set()

def _save_seen(seen: set) -> None:
    try:
        SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEEN_PATH.write_text("\n".join(list(seen)[-MAX_SEEN:]), encoding="utf-8")
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

def _append_buffer(events: list) -> None:
    existing = _load_buffer()
    _save_buffer(existing + events)


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

def _append_browser_buffer(event: dict) -> None:
    existing = _load_browser_buffer()
    existing.append(event)
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

def _parse_file(path: pathlib.Path, seen: set) -> list:
    events = []
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
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
    except Exception as e:
        _log(f"parse error {path}: {e}")
    return events

def _collect(seen: set) -> list:
    events = []
    for p in sorted(CLAUDE_DIR.glob(SESSIONS_GLOB)):
        events.extend(_parse_file(p, seen))
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
        r = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
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
    if not events:
        return 0, None
    ok_count = 0
    failed = []
    for i in range(0, len(events), SEND_CHUNK):
        chunk = events[i:i + SEND_CHUNK]
        if _send_chunk(chunk, cfg):
            ok_count += len(chunk)
        else:
            failed.extend(chunk)
    if failed:
        _append_buffer(failed)
        return ok_count, f"Send failed — {len(failed)} buffered"
    return ok_count, None

# ---------------------------------------------------------------------------
# Browser URL detection
# ---------------------------------------------------------------------------
def _get_ai_tool_from_network() -> str | None:
    """Detect active AI tool by querying Windows DNS client cache."""
    try:
        import subprocess
        ps = r"""
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-DnsClientCache | Select-Object -ExpandProperty Entry
"""
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, timeout=5,
            creationflags=CREATE_NO_WINDOW,
        )
        try:
            output = r.stdout.decode("utf-8")
        except UnicodeDecodeError:
            output = r.stdout.decode("cp1251", errors="replace")

        dns_entries = output.strip().lower()
        for pattern, tool in AI_NETWORK_PATTERNS.items():
            if pattern in dns_entries:
                return tool
        return None
    except Exception as e:
        _log(f"network detection error: {e}")
        return None


def _get_active_browser_url() -> str | None:
    """Return AI tool name using DNS cache (primary) + window title (fallback)."""
    # Method 1: DNS cache — works regardless of window title language
    tool = _get_ai_tool_from_network()
    if tool:
        _log(f"browser match (dns): {tool}")
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
        browser_keywords = ["Google Chrome", "Microsoft Edge", "Firefox", "Opera", "Brave"]
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
        payload = {"engineer_id": cfg["engineer_id"], "secret": cfg["secret"], **event}
        r = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            _log(f"browser session sent: tool={tool} duration={duration_sec}s")
            _flush_browser_buffer(cfg)
            return True
        _log(f"browser session error {r.status_code}: buffering")
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
    sent = []
    for event in buffered:
        try:
            url = cfg["endpoint"].rstrip("/") + "/api/telemetry/tool-sessions"
            payload = {"engineer_id": cfg["engineer_id"], "secret": cfg["secret"], **event}
            r = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
            if r.status_code == 200:
                sent.append(event)
                _log(f"browser buffer flushed: tool={event['tool']} duration={event['duration_sec']}s")
        except Exception:
            pass
    remaining = [e for e in buffered if e not in sent]
    _save_browser_buffer(remaining)
    if sent:
        _log(f"browser buffer: flushed {len(sent)}, remaining {len(remaining)}")


# ---------------------------------------------------------------------------
# Autostart
# ---------------------------------------------------------------------------
def _autostart_enabled() -> bool:
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN)
        winreg.QueryValueEx(key, APP_NAME)
        winreg.CloseKey(key)
        return True
    except Exception:
        return False

def _set_autostart(enable: bool) -> None:
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN,
                             0, winreg.KEY_ALL_ACCESS)
        if enable:
            exe = pathlib.Path(__file__).resolve()
            if exe.suffix.lower() == ".py":
                val = f'pythonw.exe "{exe}"'
            else:
                val = f'"{exe}"'
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, val)
            _log("autostart enabled")
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
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
    draw.ellipse([4, 4, 60, 60], fill=color)
    draw.rectangle([20, 24, 44, 40], fill=(255, 255, 255, 220))
    return img

# ---------------------------------------------------------------------------
# Main app class
# ---------------------------------------------------------------------------
class TelemetryTrayApp:

    def __init__(self):
        self._stop              = threading.Event()
        self._poll_thread       = None
        self._browser_thread    = None
        self._heartbeat_thread  = None
        self._settings_win      = None
        self._status         = "Initializing..."
        self._load_cfg()

    def _load_cfg(self) -> dict:
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
        _log("polling started (claude code + browser + heartbeat)")

    def _stop_poll(self) -> None:
        self._stop.set()

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            self._do_cycle()
            self._stop.wait(POLL_INTERVAL)

    def _browser_loop(self) -> None:
        """Track time spent on AI tools in the active browser tab."""
        current_tool  = None
        session_start = None
        last_seen     = None
        _tick         = 0

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
                    _log(f"browser tick {_tick}: tool={tool} current={current_tool}")

                if tool:
                    if current_tool != tool:
                        # Switched tool — flush previous session first
                        if current_tool and session_start and last_seen:
                            dur = int(last_seen - session_start)
                            if dur >= 30:
                                date_str = datetime.fromtimestamp(session_start).strftime("%Y-%m-%d")
                                _send_browser_session(cfg, current_tool, dur, date_str)
                        current_tool  = tool
                        session_start = now
                    last_seen = now
                else:
                    # No AI tool active — flush if gap exceeded
                    if current_tool and session_start and last_seen:
                        if now - last_seen > BROWSER_SESSION_GAP:
                            dur = int(last_seen - session_start)
                            if dur >= 30:
                                date_str = datetime.fromtimestamp(session_start).strftime("%Y-%m-%d")
                                _send_browser_session(cfg, current_tool, dur, date_str)
                            current_tool  = None
                            session_start = None
                            last_seen     = None
            except Exception as e:
                _log(f"browser loop error: {e}")

            self._stop.wait(BROWSER_POLL_INTERVAL)

    def _heartbeat_loop(self) -> None:
        """Ping backend every 10 minutes to prevent Render free plan sleep."""
        while not self._stop.is_set():
            try:
                cfg = self._load_cfg()
                endpoint = cfg.get("endpoint", DEFAULT_ENDPOINT)
                r = requests.get(
                    f"{endpoint.rstrip('/')}/api/overview",
                    timeout=10,
                )
                if r.status_code == 200:
                    _log("heartbeat ok")
                else:
                    _log(f"heartbeat {r.status_code}")
            except Exception as e:
                _log(f"heartbeat error: {e}")
            self._stop.wait(HEARTBEAT_INTERVAL)

    def _do_cycle(self) -> None:
        cfg = self._load_cfg()
        if not cfg.get("engineer_id") or not cfg.get("secret"):
            self._set_status("No config — open Settings")
            return
        try:
            seen       = _load_seen()
            buffered   = _load_buffer()
            new_events = _collect(seen)
            all_events = buffered + new_events
            if not all_events:
                ts = datetime.now().strftime("%H:%M")
                self._set_status(f"{ts}  +0 events sent")
                return
            count, err = _send_all(all_events, cfg)
            for e in new_events:
                seen.add(e["event_id"])
            _save_seen(seen)
            if not err:
                _save_buffer([])
            ts = datetime.now().strftime("%H:%M")
            buf_left = len(_load_buffer())
            if buf_left:
                self._set_status(f"{ts}  buffered ({buf_left})")
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

    def _on_settings(self, *_) -> None:
        self.root.after(0, self._open_settings)

    def _on_quit(self, *_) -> None:
        try:
            if LOCK_FILE.exists():
                LOCK_FILE.unlink()
        except Exception:
            pass
        self._stop_poll()
        self._icon.stop()
        self.root.quit()

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
        row("Email (@homealliance.com):", var_email)

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
            if not email.lower().endswith("@homealliance.com"):
                lbl_status.config(text="Only @homealliance.com email is allowed.")
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
        win.geometry("460x310")
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

        btn_row = tk.Frame(frm)
        btn_row.grid(row=frm.grid_size()[1], column=0, columnspan=2, pady=8)
        tk.Button(btn_row, text="Save",     command=save,                    width=10).pack(side="left", padx=4)
        tk.Button(btn_row, text="Test",     command=test,                    width=10).pack(side="left", padx=4)
        tk.Button(btn_row, text="View Log", command=self._open_log_viewer,   width=10).pack(side="left", padx=4)
        tk.Button(btn_row, text="Close",    command=win.destroy,             width=10).pack(side="left", padx=4)

    def run(self) -> None:
        _ensure_single_instance()
        self.root = tk.Tk()
        self.root.withdraw()

        menu = pystray.Menu(
            pystray.MenuItem("Run Now",           self._on_run_now),
            pystray.MenuItem("View Log",          self._on_view_log),
            pystray.MenuItem("Start with Windows",
                             self._on_toggle_autostart,
                             checked=lambda item: _autostart_enabled()),
            pystray.MenuItem("Settings…",         self._on_settings),
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
        else:
            self._start_poll()

        self.root.mainloop()


if __name__ == "__main__":
    TelemetryTrayApp().run()
