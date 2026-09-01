"""Memory instrumentation for the telemetry tray app.

Two entry points:

* ``MemDebugger`` — periodic tracemalloc snapshots + RSS, written to memdebug.log.
  Enabled with ``--memdebug``; costs nothing when it is off (tracemalloc is never
  started).
* ``rss_mb()`` — cheap current-RSS reading, used by the watchdog and the heartbeat
  payload. Safe to call on any platform and with no third-party dependency
  installed.

Kept in its own module so the measurement harness does not itself become part of
what is being measured, and so it can be imported by the collector script as well
as the tray app.
"""

from __future__ import annotations

import os
import threading
import time
import tracemalloc
from datetime import datetime

# psutil is the preferred source, but the frozen tray exe should not hard-fail if
# it is missing. On Windows, GetProcessMemoryInfo via ctypes gives the same
# WorkingSetSize that psutil reports as RSS.
try:
    import psutil
    _PROC = psutil.Process()
except Exception:  # pragma: no cover - import guard
    psutil = None
    _PROC = None


def rss_mb() -> float:
    """Resident set size in MB, or 0.0 if it cannot be determined."""
    if _PROC is not None:
        try:
            return _PROC.memory_info().rss / (1024 * 1024)
        except Exception:
            pass
    try:
        import ctypes
        from ctypes import wintypes

        class _PMC(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = _PMC()
        counters.cb = ctypes.sizeof(_PMC)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        if ctypes.windll.psapi.GetProcessMemoryInfo(
            handle, ctypes.byref(counters), counters.cb
        ):
            return counters.WorkingSetSize / (1024 * 1024)
    except Exception:
        pass
    return 0.0


def top_allocations(limit: int = 10) -> list:
    """Top allocation sites as ``["<file>:<line>  <KiB> KiB (<count> blocks)", ...]``.

    Returns an empty list when tracemalloc is not tracing, so callers (the
    watchdog) can log whatever is available without branching.
    """
    if not tracemalloc.is_tracing():
        return []
    try:
        stats = tracemalloc.take_snapshot().statistics("lineno")[:limit]
        return [
            f"{s.traceback[0].filename}:{s.traceback[0].lineno}  "
            f"{s.size / 1024:.1f} KiB ({s.count} blocks)"
            for s in stats
        ]
    except Exception:
        return []


class MemDebugger:
    """Periodic tracemalloc + RSS sampler writing a human-readable report."""

    def __init__(self, log_path, interval_sec: float = 60.0, top: int = 20):
        self.log_path = log_path
        self.interval = interval_sec
        self.top = top
        self._prev = None
        self._start_rss = None
        self._sample = 0
        self._stop = threading.Event()
        self._thread = None

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        tracemalloc.start(25)
        self._start_rss = rss_mb()
        self._write(
            f"=== memdebug started pid={os.getpid()} "
            f"interval={self.interval}s rss={self._start_rss:.1f}MB ==="
        )
        self._thread = threading.Thread(
            target=self._loop, name="memdebug", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.sample(final=True)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.sample()
            except Exception as exc:  # never let the sampler kill the app
                self._write(f"memdebug sample error: {exc}")

    # -- sampling ----------------------------------------------------------
    def sample(self, final: bool = False) -> None:
        self._sample += 1
        snap = tracemalloc.take_snapshot()
        rss = rss_mb()
        traced_cur, traced_peak = tracemalloc.get_traced_memory()

        head = (
            f"--- sample #{self._sample}{' (final)' if final else ''} "
            f"{datetime.now().strftime('%H:%M:%S')} "
            f"rss={rss:.1f}MB (start {self._start_rss:.1f}MB, "
            f"delta {rss - self._start_rss:+.1f}MB) "
            f"traced={traced_cur / 1e6:.1f}MB peak={traced_peak / 1e6:.1f}MB ---"
        )
        lines = [head, f"top {self.top} allocation sites (cumulative):"]
        for stat in snap.statistics("lineno")[: self.top]:
            frame = stat.traceback[0]
            lines.append(
                f"  {stat.size / 1024:9.1f} KiB  {stat.count:7d} blocks  "
                f"{frame.filename}:{frame.lineno}"
            )

        if self._prev is not None:
            lines.append(f"top {self.top} GROWTH vs previous sample:")
            diff = snap.compare_to(self._prev, "lineno")[: self.top]
            for stat in diff:
                frame = stat.traceback[0]
                lines.append(
                    f"  {stat.size_diff / 1024:+9.1f} KiB  "
                    f"{stat.count_diff:+7d} blocks  "
                    f"{frame.filename}:{frame.lineno}"
                )

        self._prev = snap
        self._write("\n".join(lines))

    def _write(self, text: str) -> None:
        try:
            with open(self.log_path, "a", encoding="utf-8") as fh:
                fh.write(text + "\n")
        except Exception:
            pass
