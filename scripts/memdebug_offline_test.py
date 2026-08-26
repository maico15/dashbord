#!/usr/bin/env python3
"""Offline-scenario check for the telemetry collector's retry buffer.

Drives N collector cycles against an endpoint that refuses every connection and
reports, per cycle, how large the retry buffer got and how much RSS the process
is holding. Run it against the fixed module and against the pre-fix module (via
--from-git) to show the difference.

    python scripts/memdebug_offline_test.py --cycles 12
    python scripts/memdebug_offline_test.py --cycles 12 --from-git HEAD
"""
import argparse
import importlib.util
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cc_memdebug import rss_mb  # noqa: E402

# Nothing listens here, so every POST fails immediately rather than hanging.
DEAD_ENDPOINT = "http://127.0.0.1:9"


def load_module(from_git: str | None):
    """Import cc_tray_app — either the working tree copy or a git revision."""
    if not from_git:
        import cc_tray_app
        return cc_tray_app, "working tree"
    src = subprocess.run(
        ["git", "show", f"{from_git}:cc_tray_app.py"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    tmp = pathlib.Path(tempfile.mkdtemp()) / "cc_tray_app_before.py"
    tmp.write_text(src, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("cc_tray_app_before", tmp)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["cc_tray_app_before"] = mod
    spec.loader.exec_module(mod)
    return mod, f"git {from_git}"


def redirect_state(mod, state: pathlib.Path):
    """Point every state file at a scratch dir so the real agent is untouched."""
    state.mkdir(parents=True, exist_ok=True)
    mod.BUFFER_PATH = state / "telemetry_buffer.jsonl"
    mod.SEEN_PATH = state / ".telemetry_seen"
    mod.LOG_PATH = state / "telemetry_tray.log"
    mod.BROWSER_SESSIONS_PATH = state / "browser_sessions.jsonl"
    mod.BROWSER_BUFFER_PATH = state / "browser_sessions_buffer.jsonl"
    for name in ("OFFSETS_PATH", "DROPS_PATH"):
        if hasattr(mod, name):
            setattr(mod, name, state / f".telemetry_{name.split('_')[0].lower()}.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cycles", type=int, default=12)
    ap.add_argument("--from-git", help="run the module as of this git revision")
    ap.add_argument("--state-dir", default=".memdebug_state_offline")
    ap.add_argument("--max-buffer", type=int,
                    help="override MAX_BUFFER_EVENTS so the drop-oldest path is "
                         "exercised on a dataset smaller than the real cap")
    ap.add_argument("--synthetic", type=int, default=0,
                    help="append N fresh events per cycle to a scratch session "
                         "file, so new work keeps arriving while offline")
    args = ap.parse_args()

    mod, label = load_module(args.from_git)
    if args.max_buffer and hasattr(mod, "MAX_BUFFER_EVENTS"):
        mod.MAX_BUFFER_EVENTS = args.max_buffer
        label += f", cap={args.max_buffer}"
    state = ROOT / args.state_dir
    if state.exists():
        shutil.rmtree(state)
    redirect_state(mod, state)

    synth_file = None
    if args.synthetic:
        # Point the collector at a scratch session tree and append fresh records
        # before each cycle, so new events keep arriving while the endpoint is
        # down — the condition under which the drop counter should keep rising.
        synth_root = state / "fake_claude"
        (synth_root / "projects" / "proj").mkdir(parents=True, exist_ok=True)
        synth_file = synth_root / "projects" / "proj" / "session.jsonl"
        synth_file.touch()
        mod.CLAUDE_DIR = synth_root

    def emit(cycle: int, n: int) -> None:
        import json as _json
        with open(synth_file, "a", encoding="utf-8") as fh:
            for k in range(n):
                fh.write(_json.dumps({
                    "type": "assistant",
                    "sessionId": f"synthetic-{cycle}",
                    "timestamp": f"2026-08-26T00:{cycle % 60:02d}:{k % 60:02d}",
                    "cwd": "/tmp/proj",
                    "message": {"model": "claude-opus-5",
                                "usage": {"input_tokens": 100 + k,
                                          "output_tokens": 10 + k}},
                }) + "\n")

    app = mod.TelemetryTrayApp()
    cfg = dict(app._load_cfg())
    cfg["endpoint"] = DEAD_ENDPOINT
    # Both module versions read config through _load_cfg; override it wholesale so
    # this works against the pre-fix module too (it has no override hook).
    app._load_cfg = lambda: cfg
    app._set_status = lambda *_: None

    print(f"offline scenario — {label}, {args.cycles} cycles, endpoint {DEAD_ENDPOINT}")
    print(f"{'cycle':>5}  {'buffer_events':>13}  {'buffer_kb':>9}  {'rss_mb':>7}  {'dropped':>7}")
    for i in range(1, args.cycles + 1):
        if synth_file is not None:
            emit(i, args.synthetic)
        app._do_cycle()
        buf = mod.BUFFER_PATH
        n = len(mod._load_buffer())
        kb = buf.stat().st_size / 1024 if buf.exists() else 0
        dropped = mod._read_drop_counter() if hasattr(mod, "_read_drop_counter") else 0
        print(f"{i:>5}  {n:>13}  {kb:>9.1f}  {rss_mb():>7.1f}  {dropped:>7}")


if __name__ == "__main__":
    main()
