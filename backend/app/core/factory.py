from __future__ import annotations

from uuid import uuid4

from app.core.chats import GroupChat, PrivateChat


class ChatFactory:
    def __init__(self, history_limit: int) -> None:
        self._history_limit = history_limit

    def create_room(self, title: str) -> GroupChat:
        chat_id = str(uuid4())
        return GroupChat(chat_id=chat_id, title=title, history_limit=self._history_limit)

    def create_private_chat(self, user_one_id: str, user_two_id: str) -> PrivateChat:
        chat_id = str(uuid4())
        return PrivateChat(
            chat_id=chat_id,
            history_limit=self._history_limit,
            user_one_id=user_one_id,
            user_two_id=user_two_id,
        )
