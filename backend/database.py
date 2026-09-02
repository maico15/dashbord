import os
import re
from contextlib import contextmanager

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Refusing to start rather than silently falling "
        "back to a local SQLite file — a forgotten env var during the ECS cutover "
        "would otherwise cause writes to go to an ephemeral local DB instead of the "
        "shared database (split-brain data). Set DATABASE_URL to a PostgreSQL "
        "connection string (see docker-compose.yml for local dev), or explicitly set "
        "DATABASE_URL=sqlite:///./dashboard.db for local SQLite-only testing."
    )
# Render and older Heroku use postgres://, SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

IS_POSTGRES = DATABASE_URL.startswith("postgresql")

if IS_POSTGRES:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        pool_recycle=300,
        pool_pre_ping=True,
        # Server-side deadlines. Most endpoints take a connection from get_db()
        # without a try/finally, so an unexpected error mid-request can leak the
        # connection while its transaction is in the aborted state — holding row
        # and index locks forever, blocking later writers, and permanently
        # consuming a pool slot until the pool is exhausted and every request
        # fails on checkout. These make the database clean up after us:
        #   idle_in_transaction_session_timeout - kill a connection parked in a
        #     transaction (aborted or not) for 60s, releasing its locks and slot.
        #   lock_timeout - fail a statement that waits 15s for a lock instead of
        #     blocking indefinitely behind a leaked transaction.
        #   statement_timeout - backstop for a runaway query; generous enough for
        #     the GitHub/Jira sync jobs and startup DDL.
        connect_args={
            "options": (
                "-c idle_in_transaction_session_timeout=60000 "
                "-c lock_timeout=15000 "
                "-c statement_timeout=120000"
            ),
        },
    )
else:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

# For INSERT OR REPLACE → ON CONFLICT (...) DO UPDATE: maps table → unique key columns
_CONFLICT_TARGETS: dict = {
    "ai_usage_cache":  ["key"],
    "config":          ["key"],
    "roadmap_meta":    ["key"],
    "score_rules":     ["stream", "rule_key"],
    "dev_metrics":     ["member_id", "week", "year"],
    "support_metrics": ["member_id", "week", "year"],
    "docs_metrics":    ["member_id", "week", "year"],
    "weekly_tasks":    ["engineer_id", "week_number", "year"],
    "daily_reports":   ["engineer_id", "report_date"],
    "pr_log":          ["repo", "pr_number"],
}

_OR_REPLACE = re.compile(
    r"INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)", re.IGNORECASE | re.DOTALL
)
_OR_IGNORE = re.compile(r"INSERT\s+OR\s+IGNORE\s+INTO", re.IGNORECASE)
_INSERT_TABLE = re.compile(r'\s*INSERT\s+INTO\s+"?(\w+)"?', re.IGNORECASE)

# table name -> whether it has an "id" column, filled lazily from information_schema.
# Appending "RETURNING id" to an INSERT against a table that has no id column (config,
# roadmap_meta, weekly_changes, gantt_visibility, backlog_retired) raises UndefinedColumn
# on Postgres, and any raised error aborts the whole transaction — every later statement
# on that connection then fails with InFailedSqlTransaction. Asking the catalog once per
# table is both cheaper and safer than issuing a statement that is expected to fail.
_ID_COLUMN_CACHE: dict = {}


def _table_has_id(sa_conn, table: str) -> bool:
    if table not in _ID_COLUMN_CACHE:
        row = sa_conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :t AND column_name = 'id' LIMIT 1"
            ),
            {"t": table},
        ).fetchone()
        _ID_COLUMN_CACHE[table] = row is not None
    return _ID_COLUMN_CACHE[table]


class Row(dict):
    """dict that also supports integer-index access (row[0]) for COUNT(*) queries."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class Cursor:
    def __init__(self, sa_conn):
        self._conn = sa_conn
        self._result = None
        self.lastrowid = None
        self.rowcount = -1

    @staticmethod
    def _to_named(sql: str, params) -> tuple:
        """Replace ? placeholders with :p0 :p1 … and return (sql, params_dict)."""
        if not params:
            return sql, {}
        if isinstance(params, dict):
            return sql, params
        named: dict = {}
        for i, v in enumerate(params):
            named[f"p{i}"] = v
            sql = sql.replace("?", f":p{i}", 1)
        return sql, named

    @staticmethod
    def _adapt_upsert(sql: str) -> str:
        """Convert SQLite INSERT OR REPLACE/IGNORE to PostgreSQL ON CONFLICT syntax."""
        if not IS_POSTGRES:
            return sql

        if _OR_IGNORE.match(sql):
            return _OR_IGNORE.sub("INSERT INTO", sql, count=1).rstrip().rstrip(";") \
                   + " ON CONFLICT DO NOTHING"

        m = _OR_REPLACE.match(sql)
        if m:
            table = m.group(1)
            cols = [c.strip() for c in m.group(2).split(",")]
            sql = re.sub(r"INSERT\s+OR\s+REPLACE\s+INTO", "INSERT INTO", sql,
                         count=1, flags=re.IGNORECASE)
            targets = _CONFLICT_TARGETS.get(table, [])
            if targets:
                update_cols = [c for c in cols if c not in targets]
                if update_cols:
                    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in update_cols)
                    conflict = f"ON CONFLICT ({', '.join(targets)}) DO UPDATE SET {updates}"
                else:
                    conflict = f"ON CONFLICT ({', '.join(targets)}) DO NOTHING"
                return sql.rstrip().rstrip(";") + f" {conflict}"

        return sql

    def execute(self, sql: str, params=()):
        sql = self._adapt_upsert(sql)
        sql, named = self._to_named(sql, params)

        m = _INSERT_TABLE.match(sql) if IS_POSTGRES else None
        if m and "RETURNING" not in sql.upper() and _table_has_id(self._conn, m.group(1)):
            # SAVEPOINT so an unexpected failure here (permissions, a concurrently
            # dropped column) rolls back only this statement rather than aborting the
            # caller's transaction and poisoning every statement issued after it.
            sp = self._conn.begin_nested()
            try:
                result = self._conn.execute(text(sql + " RETURNING id"), named)
                # RETURNING emits one row per row actually written: none when
                # ON CONFLICT DO NOTHING swallowed the insert, and N for a bulk
                # INSERT ... SELECT. Both matter — `rowcount == 0` is the
                # duplicate check for ai_events/pr_log/commit_log, and callers
                # like the ai_usage_daily rebuild read rowcount as a row count,
                # so taking only the first row here would report a bulk insert
                # of N rows as 1. psycopg2 buffers the whole result set client
                # side anyway, so fetchall costs nothing over fetchone.
                rows = result.fetchall()
                sp.commit()
                self.lastrowid = rows[0][0] if rows else None
                self.rowcount = len(rows)
                return self
            except Exception:
                sp.rollback()  # fall through to a plain execute on a clean transaction

        self._result = self._conn.execute(text(sql), named)
        self.rowcount = self._result.rowcount
        if hasattr(self._result, "lastrowid"):
            self.lastrowid = self._result.lastrowid
        return self

    def executemany(self, sql: str, params_list):
        for params in params_list:
            self.execute(sql, params)

    def fetchone(self):
        if self._result is None:
            return None
        row = self._result.fetchone()
        return Row(row._mapping) if row is not None else None

    def fetchall(self):
        if self._result is None:
            return []
        return [Row(r._mapping) for r in self._result.fetchall()]

    def __iter__(self):
        return iter(self.fetchall())


class DBWrapper:
    def __init__(self, sa_conn):
        self._conn = sa_conn

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        """Commit on success, roll back on error, and always return the connection
        to the pool. `with get_db() as conn:` is the safe way to acquire a
        connection — a bare `conn = get_db()` leaks it if anything raises."""
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        except Exception:
            pass  # never mask the original error, and never skip close()
        finally:
            self._conn.close()
        return False

    def cursor(self) -> Cursor:
        return Cursor(self._conn)

    def execute(self, sql: str, params=()):
        c = Cursor(self._conn)
        c.execute(sql, params)
        return c

    def executemany(self, sql: str, params_list):
        Cursor(self._conn).executemany(sql, params_list)

    def executescript(self, script: str):
        """Execute multiple DDL statements, transforming syntax for the active dialect."""
        for stmt in script.split(";"):
            stmt = stmt.strip()
            if not stmt:
                continue
            if IS_POSTGRES:
                if re.match(r"PRAGMA", stmt, re.IGNORECASE):
                    continue
                stmt = re.sub(
                    r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT",
                    "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
                    stmt, flags=re.IGNORECASE,
                )
                # Column stays TEXT (no type changes in this migration), and Postgres
                # has no implicit cast from timestamptz to text, so the default must
                # be cast explicitly rather than left as a bare CURRENT_TIMESTAMP.
                stmt = re.sub(
                    r"DEFAULT\s+\(datetime\('now'\)\)",
                    "DEFAULT (now()::text)",
                    stmt, flags=re.IGNORECASE,
                )
            self._conn.execute(text(stmt))
        self._conn.commit()

    @contextmanager
    def step(self, label: str):
        """Run one startup/migration step so its failure can never take the process down
        and — critically on Postgres — can never leave the connection in an aborted
        transaction that poisons every step after it. Commits on success, rolls back and
        logs on failure, always continues."""
        try:
            yield self
            self.commit()
            print(f"[init] {label}: OK")
        except Exception as ex:
            self.rollback()
            print(f"[init] {label}: skipped/rolled back: {ex}")

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def get_columns(self, table: str) -> set:
        """Column names for `table`, dialect-aware (PRAGMA on SQLite, information_schema
        on Postgres) so callers never issue a raw PRAGMA through Cursor.execute() —
        which, unlike executescript(), does not strip/translate PRAGMA for Postgres."""
        if IS_POSTGRES:
            rows = self.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
                (table,),
            ).fetchall()
            return {r["column_name"] for r in rows}
        rows = self.execute(f"PRAGMA table_info({table})").fetchall()
        return {r["name"] for r in rows}

    def add_column_if_missing(self, table: str, column: str, ddl_suffix: str):
        """Idempotent `ALTER TABLE ... ADD COLUMN`, checked via get_columns() rather
        than relying on catching a duplicate-column error. On Postgres, an uncaught
        error from an ALTER that's already been applied aborts the connection's
        transaction — every later statement on the same connection then fails with
        "current transaction is aborted" until a rollback(), which can silently
        poison the rest of a multi-statement init routine. This checks first, and
        still rolls back defensively if the ALTER itself fails for another reason."""
        if column in self.get_columns(table):
            return
        try:
            self.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_suffix}")
            self.commit()
        except Exception as ex:
            self.rollback()
            print(f"[db] ALTER TABLE {table} ADD COLUMN {column} failed: {ex}")


def get_db() -> DBWrapper:
    return DBWrapper(engine.connect())
