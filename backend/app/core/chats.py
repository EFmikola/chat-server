from __future__ import annotations

from collections import deque
from datetime import datetime
from app.domain.models import Message
from app.errors import DmCapacityError


class BaseChat:
    __slots__ = ("_id", "_chat_type", "_title", "_members", "_history", "_last_message_at")

    def __init__(self, chat_id: str, chat_type: str, title: str, history_limit: int) -> None:
        self._id = chat_id
        self._chat_type = chat_type
        self._title = title
        self._members: set[str] = set()
        self._history: deque[Message] = deque(maxlen=history_limit)
        self._last_message_at: datetime | None = None

    @property
    def id(self) -> str:
        return self._id

    @property
    def chat_type(self) -> str:
        return self._chat_type

    @property
    def title(self) -> str:
        return self._title

    @property
    def last_message_at(self) -> datetime | None:
        return self._last_message_at

    @property
    def message_history(self) -> tuple[Message, ...]:
        return tuple(self._history)

    @property
    def members(self) -> tuple[str, ...]:
        return tuple(sorted(self._members))

    def add_member(self, user_id: str) -> None:
        self._members.add(user_id)

    def remove_member(self, user_id: str) -> None:
        self._members.discard(user_id)

    def has_member(self, user_id: str) -> bool:
        return user_id in self._members

    def append_message(self, message: Message) -> None:
        self._history.append(message)
        self._last_message_at = message.created_at

    def recent_messages(self, limit: int, before: datetime | None = None) -> list[Message]:
        messages = list(self._history)
        if before is not None:
            messages = [item for item in messages if item.created_at < before]
        return messages[-limit:]

    def notify_targets(self) -> tuple[str, ...]:
        return self.members


class GroupChat(BaseChat):
    def __init__(self, chat_id: str, title: str, history_limit: int) -> None:
        super().__init__(chat_id=chat_id, chat_type="room", title=title, history_limit=history_limit)


class PrivateChat(BaseChat):
    def __init__(self, chat_id: str, history_limit: int, user_one_id: str, user_two_id: str) -> None:
        super().__init__(chat_id=chat_id, chat_type="dm", title="Direct messages", history_limit=history_limit)
        self.add_member(user_one_id)
        self.add_member(user_two_id)

    def add_member(self, user_id: str) -> None:
        if user_id in self._members:
            return
        if len(self._members) >= 2:
            raise DmCapacityError("Private chat can contain only two users")
        super().add_member(user_id)
