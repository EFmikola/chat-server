from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import asyncio
import logging
import sqlite3
from typing import Literal

from app.domain.models import Message, utc_now
from app.storage.repository import SQLiteRepository


@dataclass(slots=True)
class WriteJob:
    job_type: Literal["message", "event"]
    message: Message | None = None
    event_type: str | None = None
    username: str | None = None
    chat_id: str | None = None
    payload: dict | None = None
    created_at: datetime | None = None


class AsyncSQLiteWriter:
    def __init__(self, repository: SQLiteRepository, logger: logging.Logger) -> None:
        self._repository = repository
        self._logger = logger
        self._queue: asyncio.Queue[WriteJob | None] = asyncio.Queue()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="sqlite-writer-task")

    async def stop(self) -> None:
        if self._task is None:
            return
        await self._queue.put(None)
        await self._task
        self._task = None

    def enqueue_message(self, message: Message) -> None:
        self._queue.put_nowait(WriteJob(job_type="message", message=message))

    def enqueue_event(self, event_type: str, username: str | None, chat_id: str | None, payload: dict | None) -> None:
        self._queue.put_nowait(
            WriteJob(
                job_type="event",
                event_type=event_type,
                username=username,
                chat_id=chat_id,
                payload=payload,
                created_at=utc_now(),
            )
        )

    async def _run(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                if job is None:
                    return
                if job.job_type == "message":
                    if job.message is None:
                        continue
                    await asyncio.to_thread(self._repository.insert_message, job.message)
                    continue
                if job.event_type is None or job.created_at is None:
                    continue
                await asyncio.to_thread(
                    self._repository.insert_event,
                    job.event_type,
                    job.username,
                    job.chat_id,
                    job.payload,
                    job.created_at,
                )
            except sqlite3.DatabaseError:
                self._logger.exception("SQLite write failed")
            finally:
                self._queue.task_done()
