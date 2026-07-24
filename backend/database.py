import os
import re

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    _db_path = os.environ.get("DB_PATH", "./dashboard.db")
    DATABASE_URL = f"sqlite:///{_db_path}"
# Render and older Heroku use postgres://, SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

IS_POSTGRES = DATABASE_URL.startswith("postgresql")

if IS_POSTGRES:
    engine = create_engine(DATABASE_URL)
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

        if IS_POSTGRES and re.match(r"\s*INSERT\s+INTO", sql, re.IGNORECASE) \
                and "RETURNING" not in sql.upper():
            try:
                result = self._conn.execute(text(sql + " RETURNING id"), named)
                row = result.fetchone()
                self.lastrowid = row[0] if row else None
                return self
            except Exception:
                pass  # table has no 'id' column; fall through to plain execute

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
                    "SERIAL PRIMARY KEY",
                    stmt, flags=re.IGNORECASE,
                )
                stmt = re.sub(
                    r"DEFAULT\s+\(datetime\('now'\)\)",
                    "DEFAULT CURRENT_TIMESTAMP",
                    stmt, flags=re.IGNORECASE,
                )
            self._conn.execute(text(stmt))
        self._conn.commit()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def get_db() -> DBWrapper:
    return DBWrapper(engine.connect())
