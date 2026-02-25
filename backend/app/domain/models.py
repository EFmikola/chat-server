from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class User:
    id: str
    username: str
    created_at: datetime = field(default_factory=utc_now)
    last_seen_at: datetime | None = None

    @classmethod
    def create(cls, username: str) -> "User":
        return cls(id=str(uuid4()), username=username)

    def mark_seen(self) -> None:
        self.last_seen_at = utc_now()


@dataclass(slots=True)
class Message:
    id: str
    chat_id: str
    sender_username: str
    content: str
    created_at: datetime
    kind: str

    @classmethod
    def create(cls, chat_id: str, sender_username: str, content: str, kind: str = "text") -> "Message":
        return cls(
            id=str(uuid4()),
            chat_id=chat_id,
            sender_username=sender_username,
            content=content,
            created_at=utc_now(),
            kind=kind,
        )

    def to_payload(self) -> dict[str, str]:
        return {
            "id": self.id,
            "chat_id": self.chat_id,
            "sender_username": self.sender_username,
            "content": self.content,
            "created_at": self.created_at.isoformat(),
            "kind": self.kind,
        }
