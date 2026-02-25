from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

from app.config import Settings
from app.core.chats import BaseChat
from app.core.factory import ChatFactory
from app.core.filtering import TextFilter
from app.domain.models import Message, User
from app.errors import (
    ChatNotFoundError,
    DmSelfTargetError,
    NotChatMemberError,
    UnknownTypeError,
    ValidationError,
)
from app.storage.repository import SQLiteRepository
from app.storage.writer import AsyncSQLiteWriter
from app.transport.connection_manager import ConnectionManager
from app.transport.protocol import InboundEvent, build_event


class ChatService:
    def __init__(
        self,
        settings: Settings,
        connection_manager: ConnectionManager,
        repository: SQLiteRepository,
        writer: AsyncSQLiteWriter,
        message_filter: TextFilter,
        logger: logging.Logger,
    ) -> None:
        self._settings = settings
        self._connection_manager = connection_manager
        self._repository = repository
        self._writer = writer
        self._message_filter = message_filter
        self._logger = logger
        self._chat_factory = ChatFactory(history_limit=settings.message_history_limit)

        self._users_by_id: dict[str, User] = {}
        self._user_ids_by_name: dict[str, str] = {}
        self._chats_by_id: dict[str, BaseChat] = {}
        self._dm_chat_index: dict[tuple[str, str], str] = {}
        self._state_lock = asyncio.Lock()

    async def handle_connect(self, payload: dict[str, Any], websocket: WebSocket) -> str:
        username_raw = payload.get("username")
        if not isinstance(username_raw, str):
            raise ValidationError("Field 'payload.username' is required")

        username = username_raw.strip()
        if not username:
            raise ValidationError("Username cannot be empty")
        if len(username) > 64:
            raise ValidationError("Username is too long")

        async with self._state_lock:
            normalized = self._normalize_username(username)
            user_id = self._user_ids_by_name.get(normalized)
            if user_id is None:
                user = User.create(username=username)
                self._users_by_id[user.id] = user
                self._user_ids_by_name[normalized] = user.id
                user_id = user.id
            user = self._users_by_id[user_id]
            user_chat_ids = self._chat_ids_for_user_locked(user_id)

        await self._connection_manager.connect(user_id, websocket)
        await self._connection_manager.send(
            user_id,
            build_event(
                "connected",
                payload={"user_id": user_id, "username": user.username},
            ),
        )
        await self.send_chat_list(user_id)
        for chat_id in user_chat_ids:
            await self.broadcast_presence(chat_id)

        self._writer.enqueue_event("connect", user.username, None, {"user_id": user.id})
        return user_id

    async def disconnect_user(self, user_id: str) -> None:
        async with self._state_lock:
            user = self._users_by_id.get(user_id)
            if user is None:
                return
            user.mark_seen()
            username = user.username
            user_chat_ids = self._chat_ids_for_user_locked(user_id)

        await self._connection_manager.disconnect(user_id)
        if not user_chat_ids:
            self._writer.enqueue_event("disconnect", username, None, {"user_id": user_id})
            return
        for chat_id in user_chat_ids:
            await self.broadcast_presence(chat_id)
        self._writer.enqueue_event("disconnect", username, None, {"user_id": user_id})

    async def handle_event(self, user_id: str, event: InboundEvent) -> None:
        if event.event_type == "create_room":
            await self._handle_create_room(user_id, event)
            return
        if event.event_type == "join_room":
            await self._handle_join_room(user_id, event)
            return
        if event.event_type == "leave_room":
            await self._handle_leave_room(user_id, event)
            return
        if event.event_type == "open_dm":
            await self._handle_open_dm(user_id, event)
            return
        if event.event_type == "send_message":
            await self._handle_send_message(user_id, event)
            return
        if event.event_type == "history_request":
            await self._handle_history_request(user_id, event)
            return
        raise UnknownTypeError(event.event_type)

    async def send_chat_list(self, user_id: str) -> None:
        async with self._state_lock:
            chats = self._sorted_user_chats_locked(user_id)
            serialized = [self._serialize_chat_locked(chat, viewer_id=user_id) for chat in chats]
        await self._connection_manager.send(user_id, build_event("chat_list", payload={"chats": serialized}))

    async def broadcast_presence(self, chat_id: str) -> None:
        async with self._state_lock:
            chat = self._chats_by_id.get(chat_id)
            if chat is None:
                return
            recipient_ids = list(chat.members)
            if not recipient_ids:
                return
            online_user_ids = sorted(
                [member_id for member_id in recipient_ids if self._connection_manager.is_connected(member_id)]
            )
            event = build_event(
                "presence_update",
                payload={"chat_id": chat.id, "online_user_ids": online_user_ids},
                chat_id=chat.id,
            )

        await self._connection_manager.broadcast(recipient_ids, event)

    def username_for(self, user_id: str | None) -> str | None:
        if user_id is None:
            return None
        user = self._users_by_id.get(user_id)
        return user.username if user is not None else None

    def enqueue_error_event(self, user_id: str | None, error_code: str, message: str) -> None:
        username = self.username_for(user_id)
        self._writer.enqueue_event(
            "error",
            username,
            None,
            {"error_code": error_code, "message": message},
        )

    async def _handle_create_room(self, user_id: str, event: InboundEvent) -> None:
        title_raw = event.payload.get("title")
        if not isinstance(title_raw, str):
            raise ValidationError("Field 'payload.title' is required")

        title = title_raw.strip()
        if not title:
            raise ValidationError("Room title cannot be empty")
        if len(title) > 120:
            raise ValidationError("Room title is too long")

        async with self._state_lock:
            chat = self._chat_factory.create_room(title=title)
            chat.add_member(user_id)
            self._chats_by_id[chat.id] = chat
            user = self._require_user_locked(user_id)

            system_message = Message.create(
                chat_id=chat.id,
                sender_username="system",
                content=f"{user.username} created room {title}",
                kind="system",
            )
            chat.append_message(system_message)
            recipients = list(chat.notify_targets())

            serialized = {target_id: self._serialize_chat_locked(chat, viewer_id=target_id) for target_id in recipients}
            message_event = build_event("message", payload=system_message.to_payload(), chat_id=chat.id)

        self._writer.enqueue_message(system_message)
        self._writer.enqueue_event("create_room", user.username, chat.id, {"title": title})

        await self._send_chat_upserts(chat.id, serialized)
        await self._connection_manager.broadcast(recipients, message_event)
        await self.broadcast_presence(chat.id)

    async def _handle_join_room(self, user_id: str, event: InboundEvent) -> None:
        chat_id = self._extract_chat_id(event)
        async with self._state_lock:
            chat = self._require_chat_locked(chat_id)
            if chat.chat_type != "room":
                raise ValidationError("Join operation is available only for rooms")
            user = self._require_user_locked(user_id)

            is_new_member = not chat.has_member(user_id)
            serialized_user = None
            if is_new_member:
                chat.add_member(user_id)
            else:
                serialized_user = self._serialize_chat_locked(chat, viewer_id=user_id)

            system_message = None
            if is_new_member:
                system_message = Message.create(
                    chat_id=chat.id,
                    sender_username="system",
                    content=f"{user.username} joined room",
                    kind="system",
                )
                chat.append_message(system_message)

            recipients = list(chat.notify_targets())
            serialized = {target_id: self._serialize_chat_locked(chat, viewer_id=target_id) for target_id in recipients}
            message_event = (
                build_event("message", payload=system_message.to_payload(), chat_id=chat.id)
                if system_message is not None
                else None
            )

        if not is_new_member and serialized_user is not None:
            await self._connection_manager.send(
                user_id,
                build_event("chat_upsert", payload={"chat": serialized_user}, chat_id=chat_id),
            )
            await self.broadcast_presence(chat_id)
            return

        if is_new_member:
            self._writer.enqueue_event("join_room", user.username, chat_id, {"chat_id": chat_id})
        if system_message is not None:
            self._writer.enqueue_message(system_message)

        await self._send_chat_upserts(chat_id, serialized)
        if message_event is not None:
            await self._connection_manager.broadcast(recipients, message_event)
        await self.broadcast_presence(chat_id)

    async def _handle_leave_room(self, user_id: str, event: InboundEvent) -> None:
        chat_id = self._extract_chat_id(event)
        async with self._state_lock:
            chat = self._require_chat_locked(chat_id)
            if chat.chat_type != "room":
                raise ValidationError("Leave operation is available only for rooms")
            if not chat.has_member(user_id):
                raise NotChatMemberError("User is not a member of this room")
            user = self._require_user_locked(user_id)

            chat.remove_member(user_id)
            system_message = Message.create(
                chat_id=chat.id,
                sender_username="system",
                content=f"{user.username} left room",
                kind="system",
            )
            chat.append_message(system_message)
            remaining_recipients = list(chat.notify_targets())
            serialized_remaining = {
                target_id: self._serialize_chat_locked(chat, viewer_id=target_id)
                for target_id in remaining_recipients
            }
            message_event = build_event("message", payload=system_message.to_payload(), chat_id=chat.id)

        self._writer.enqueue_message(system_message)
        self._writer.enqueue_event("leave_room", user.username, chat_id, {"chat_id": chat_id})

        await self.send_chat_list(user_id)
        await self._send_chat_upserts(chat_id, serialized_remaining)
        await self._connection_manager.broadcast(remaining_recipients, message_event)
        await self.broadcast_presence(chat_id)

    async def _handle_open_dm(self, user_id: str, event: InboundEvent) -> None:
        target_username_raw = event.payload.get("username")
        if not isinstance(target_username_raw, str):
            raise ValidationError("Field 'payload.username' is required")

        target_username = target_username_raw.strip()
        if not target_username:
            raise ValidationError("Target username cannot be empty")

        async with self._state_lock:
            source_user = self._require_user_locked(user_id)
            target_user = self._get_or_create_user_locked(target_username)
            if target_user.id == source_user.id:
                raise DmSelfTargetError("Cannot open DM with yourself")

            dm_key = tuple(sorted((source_user.id, target_user.id)))
            created = False
            chat_id = self._dm_chat_index.get(dm_key)
            if chat_id is None:
                chat = self._chat_factory.create_private_chat(source_user.id, target_user.id)
                self._dm_chat_index[dm_key] = chat.id
                self._chats_by_id[chat.id] = chat
                created = True
            else:
                chat = self._require_chat_locked(chat_id)

            recipients = list(chat.notify_targets())
            serialized = {target_id: self._serialize_chat_locked(chat, viewer_id=target_id) for target_id in recipients}

            system_message = None
            if created:
                system_message = Message.create(
                    chat_id=chat.id,
                    sender_username="system",
                    content=f"DM opened between {source_user.username} and {target_user.username}",
                    kind="system",
                )
                chat.append_message(system_message)
            message_event = (
                build_event("message", payload=system_message.to_payload(), chat_id=chat.id)
                if system_message is not None
                else None
            )

        self._writer.enqueue_event(
            "open_dm",
            source_user.username,
            chat.id,
            {"target_username": target_user.username, "created": created},
        )
        if system_message is not None:
            self._writer.enqueue_message(system_message)

        await self._send_chat_upserts(chat.id, serialized)
        if message_event is not None:
            await self._connection_manager.broadcast(recipients, message_event)
        await self.broadcast_presence(chat.id)

    async def _handle_send_message(self, user_id: str, event: InboundEvent) -> None:
        chat_id = self._extract_chat_id(event)
        content_raw = event.payload.get("content")
        if not isinstance(content_raw, str):
            raise ValidationError("Field 'payload.content' is required")

        content = content_raw.strip()
        if not content:
            raise ValidationError("Message cannot be empty")

        async with self._state_lock:
            chat = self._require_chat_locked(chat_id)
            if not chat.has_member(user_id):
                raise NotChatMemberError("User is not a member of this chat")

            user = self._require_user_locked(user_id)
            filtered_content = self._message_filter.apply(content)
            message = Message.create(
                chat_id=chat.id,
                sender_username=user.username,
                content=filtered_content,
                kind="text",
            )
            chat.append_message(message)
            recipients = list(chat.notify_targets())
            serialized = {target_id: self._serialize_chat_locked(chat, viewer_id=target_id) for target_id in recipients}
            message_event = build_event("message", payload=message.to_payload(), chat_id=chat.id)

        self._writer.enqueue_message(message)
        self._writer.enqueue_event(
            "send_message",
            user.username,
            chat.id,
            {"message_id": message.id},
        )

        await self._connection_manager.broadcast(recipients, message_event)
        await self._send_chat_upserts(chat.id, serialized)

    async def _handle_history_request(self, user_id: str, event: InboundEvent) -> None:
        chat_id = self._extract_chat_id(event)
        limit = event.limit if event.limit is not None else self._settings.history_default_limit
        before = event.before

        async with self._state_lock:
            chat = self._require_chat_locked(chat_id)
            if not chat.has_member(user_id):
                raise NotChatMemberError("User is not a member of this chat")

            visible_history = [item for item in chat.message_history if before is None or item.created_at < before]
            memory_messages = visible_history[-limit:]
            memory_has_more = len(visible_history) > len(memory_messages)

            needed_from_db = limit - len(memory_messages)
            db_before = before
            if memory_messages:
                earliest_memory = memory_messages[0].created_at
                db_before = earliest_memory

        db_messages: list[Message] = []
        db_has_more = False
        if needed_from_db > 0:
            db_messages, db_has_more = await asyncio.to_thread(
                self._repository.fetch_messages_page,
                chat_id,
                db_before,
                needed_from_db,
            )

        merged: list[Message] = []
        dedup_ids: set[str] = set()
        for item in db_messages + memory_messages:
            if item.id in dedup_ids:
                continue
            dedup_ids.add(item.id)
            merged.append(item)

        has_more = memory_has_more or db_has_more
        payload = {
            "chat_id": chat_id,
            "messages": [item.to_payload() for item in merged],
            "has_more": has_more,
        }
        await self._connection_manager.send(user_id, build_event("history_response", payload=payload, chat_id=chat_id))

        username = self.username_for(user_id)
        self._writer.enqueue_event("history_request", username, chat_id, {"limit": limit})

    async def _send_chat_upserts(self, chat_id: str, serialized_by_user: dict[str, dict[str, Any]]) -> None:
        for user_id, serialized_chat in serialized_by_user.items():
            await self._connection_manager.send(
                user_id,
                build_event("chat_upsert", payload={"chat": serialized_chat}, chat_id=chat_id),
            )

    def _extract_chat_id(self, event: InboundEvent) -> str:
        if event.chat_id is None:
            raise ValidationError("Field 'chat_id' is required")
        return event.chat_id

    def _require_user_locked(self, user_id: str) -> User:
        user = self._users_by_id.get(user_id)
        if user is None:
            raise ValidationError("Unknown user")
        return user

    def _get_or_create_user_locked(self, username: str) -> User:
        normalized = self._normalize_username(username)
        existing_user_id = self._user_ids_by_name.get(normalized)
        if existing_user_id is not None:
            return self._users_by_id[existing_user_id]
        user = User.create(username=username)
        self._users_by_id[user.id] = user
        self._user_ids_by_name[normalized] = user.id
        return user

    def _require_chat_locked(self, chat_id: str) -> BaseChat:
        chat = self._chats_by_id.get(chat_id)
        if chat is None:
            raise ChatNotFoundError("Chat not found")
        return chat

    def _chat_ids_for_user_locked(self, user_id: str) -> list[str]:
        return [chat_id for chat_id, chat in self._chats_by_id.items() if chat.has_member(user_id)]

    def _sorted_user_chats_locked(self, user_id: str) -> list[BaseChat]:
        chats = [chat for chat in self._chats_by_id.values() if chat.has_member(user_id)]
        chats.sort(
            key=lambda item: item.last_message_at.timestamp() if item.last_message_at is not None else 0.0,
            reverse=True,
        )
        return chats

    def _serialize_chat_locked(self, chat: BaseChat, viewer_id: str) -> dict[str, Any]:
        online_user_ids = sorted(
            [member_id for member_id in chat.members if self._connection_manager.is_connected(member_id)]
        )
        members_payload = []
        for member_id in chat.members:
            user = self._users_by_id.get(member_id)
            if user is None:
                continue
            members_payload.append({"user_id": user.id, "username": user.username})

        if chat.chat_type == "dm":
            other_id = next((member_id for member_id in chat.members if member_id != viewer_id), viewer_id)
            other_user = self._users_by_id.get(other_id)
            title = other_user.username if other_user is not None else "Direct messages"
        else:
            title = chat.title

        last_message = chat.message_history[-1] if chat.message_history else None
        return {
            "id": chat.id,
            "type": chat.chat_type,
            "title": title,
            "member_ids": list(chat.members),
            "members": members_payload,
            "online_user_ids": online_user_ids,
            "last_message_at": chat.last_message_at.isoformat() if chat.last_message_at is not None else None,
            "last_message_preview": last_message.content if last_message is not None else "",
            "is_member": chat.has_member(viewer_id),
        }

    @staticmethod
    def _normalize_username(username: str) -> str:
        return username.strip().lower()
