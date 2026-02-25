from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json

from fastapi import WebSocket, WebSocketDisconnect


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class Session:
    user_id: str
    websocket: WebSocket
    connected_at: datetime = field(default_factory=_utc_now)


class ConnectionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        previous = self._sessions.get(user_id)
        if previous is not None and previous.websocket is not websocket:
            await self._safe_close(previous.websocket)
        self._sessions[user_id] = Session(user_id=user_id, websocket=websocket)

    async def disconnect(self, user_id: str) -> None:
        session = self._sessions.pop(user_id, None)
        if session is None:
            return
        await self._safe_close(session.websocket)

    async def send(self, user_id: str, payload: dict) -> bool:
        session = self._sessions.get(user_id)
        if session is None:
            return False

        try:
            serialized = json.dumps(payload, ensure_ascii=False)
            await session.websocket.send_text(serialized)
            return True
        except (RuntimeError, WebSocketDisconnect, ConnectionError):
            self._sessions.pop(user_id, None)
            return False

    async def broadcast(self, user_ids: list[str] | tuple[str, ...] | set[str], payload: dict) -> None:
        unique_ids = sorted(set(user_ids))
        for user_id in unique_ids:
            await self.send(user_id, payload)

    def connected_user_ids(self) -> set[str]:
        return set(self._sessions.keys())

    def is_connected(self, user_id: str) -> bool:
        return user_id in self._sessions

    @staticmethod
    async def _safe_close(websocket: WebSocket) -> None:
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect, ConnectionError):
            return
