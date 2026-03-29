from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json
import sqlite3

from app.domain.models import Message


class SQLiteRepository:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    def init_db(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = self._connect()
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS messages_archive (
                    message_id TEXT PRIMARY KEY,
                    chat_id TEXT NOT NULL,
                    sender_username TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    type TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_messages_chat_time
                ON messages_archive(chat_id, created_at)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS events_log (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    username TEXT,
                    chat_id TEXT,
                    payload_json TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_events_type_time
                ON events_log(event_type, created_at)
                """
            )
        finally:
            connection.close()

    def insert_message(self, message: Message) -> None:
        connection = self._connect()
        try:
            connection.execute(
                """
                INSERT OR REPLACE INTO messages_archive (
                    message_id, chat_id, sender_username, content, created_at, type
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id,
                    message.chat_id,
                    message.sender_username,
                    message.content,
                    message.created_at.isoformat(),
                    message.kind,
                ),
            )
            connection.commit()
        finally:
            connection.close()

    def insert_event(
        self,
        event_type: str,
        username: str | None,
        chat_id: str | None,
        payload: dict | None,
        created_at: datetime,
    ) -> None:
        serialized_payload = json.dumps(payload or {}, ensure_ascii=False)
        connection = self._connect()
        try:
            connection.execute(
                """
                INSERT INTO events_log (
                    event_type, username, chat_id, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (event_type, username, chat_id, serialized_payload, created_at.isoformat()),
            )
            connection.commit()
        finally:
            connection.close()

    def fetch_messages_page(self, chat_id: str, before: datetime | None, limit: int) -> tuple[list[Message], bool]:
        query = (
            """
            SELECT message_id, chat_id, sender_username, content, created_at, type
            FROM messages_archive
            WHERE chat_id = ?
            {before_clause}
            ORDER BY created_at DESC
            LIMIT ?
            """
        )
        params: list[object] = [chat_id]
        before_clause = ""
        if before is not None:
            before_clause = "AND created_at < ?"
            params.append(before.isoformat())
        params.append(limit + 1)

        connection = self._connect()
        try:
            rows = connection.execute(query.format(before_clause=before_clause), params).fetchall()
        finally:
            connection.close()

        has_more = len(rows) > limit
        if has_more:
            rows = rows[:limit]
        rows.reverse()

        messages: list[Message] = []
        for row in rows:
            messages.append(
                Message(
                    id=row["message_id"],
                    chat_id=row["chat_id"],
                    sender_username=row["sender_username"],
                    content=row["content"],
                    created_at=datetime.fromisoformat(row["created_at"]),
                    kind=row["type"],
                )
            )
        return messages, has_more

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path)
        connection.row_factory = sqlite3.Row
        return connection
