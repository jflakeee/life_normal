"""SQLite 저장소 (이행 2단계). 4단계에서 PostgreSQL로 옮긴다.

플레이어 상태는 JSON 한 칸(players.state)에 두고, 시간에 따라 쌓이는 것
(임무 실행, 돈 기록, 멱등 키)은 별도 테이블로 둔다.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Protocol

SCHEMA = """
CREATE TABLE IF NOT EXISTS towns (
    id            INTEGER PRIMARY KEY,
    state         TEXT    NOT NULL,          -- 세계 + 게시판 + 난수 (core.serialize)
    last_tick_at  REAL    NOT NULL,
    player_count  INTEGER NOT NULL DEFAULT 0,
    businesses    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS players (
    id                  TEXT PRIMARY KEY,
    token               TEXT UNIQUE NOT NULL,
    town_id             INTEGER NOT NULL REFERENCES towns(id),
    state               TEXT    NOT NULL,    -- core.serialize.player_to_dict
    version             INTEGER NOT NULL DEFAULT 0,
    missions_done       INTEGER NOT NULL DEFAULT 0,
    biz_last_settled_at REAL,
    created_at          REAL    NOT NULL
);
CREATE TABLE IF NOT EXISTS mission_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   TEXT    NOT NULL REFERENCES players(id),
    template_id TEXT    NOT NULL,
    source      TEXT    NOT NULL CHECK (source IN ('queue', 'board')),
    posting_id  TEXT,
    reward      INTEGER NOT NULL,
    started_at  REAL    NOT NULL,
    ends_at     REAL    NOT NULL,
    claimed_at  REAL
);
CREATE INDEX IF NOT EXISTS runs_open ON mission_runs (player_id, claimed_at, ends_at);
CREATE TABLE IF NOT EXISTS ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,
    amount     REAL NOT NULL,
    ref        TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_player ON ledger (player_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key        TEXT NOT NULL,
    player_id  TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (key, player_id)
);
"""


class Clock(Protocol):
    def now(self) -> float: ...


class Database:
    """연결 하나 + 잠금 하나. 모든 명령은 BEGIN IMMEDIATE 트랜잭션 안에서 실행된다."""

    def __init__(self, path: str = ":memory:"):
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if path != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.executescript(SCHEMA)
        self._lock = threading.Lock()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            else:
                self.conn.execute("COMMIT")
