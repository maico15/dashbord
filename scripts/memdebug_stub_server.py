#!/usr/bin/env python3
"""Local stand-in for the dashboard API, used only by memory-profiling runs.

Accepts and discards every telemetry POST so a 1s-interval accelerated soak
exercises the real success path without posting thousands of duplicate events to
production.

    python scripts/memdebug_stub_server.py --port 8899
"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COUNTS = {"events": 0, "posts": 0, "tool_sessions": 0}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        COUNTS["posts"] += 1
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}
        n = len(payload.get("events", []) or [])
        COUNTS["events"] += n
        if self.path.endswith("/tool-sessions"):
            COUNTS["tool_sessions"] += 1
        self._json(200, {"ok": True, "accepted": n, "duplicates": 0})

    def do_GET(self):
        self._json(200, {"ok": True, **COUNTS})

    def log_message(self, *_):
        pass  # keep the profiling console clean


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8899)
    args = p.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"stub dashboard listening on http://127.0.0.1:{args.port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
