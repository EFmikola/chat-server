from __future__ import annotations


class ChatServerError(Exception):
    code = "internal_error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code or self.code


class InvalidJSONError(ChatServerError):
    code = "invalid_json"


class ValidationError(ChatServerError):
    code = "validation_error"


class UnknownTypeError(ChatServerError):
    code = "unknown_type"

    def __init__(self, event_type: str) -> None:
        super().__init__(f"Unknown event type: {event_type}")


class NotConnectedError(ChatServerError):
    code = "not_connected"


class ChatNotFoundError(ChatServerError):
    code = "chat_not_found"


class NotChatMemberError(ChatServerError):
    code = "not_chat_member"


class DmCapacityError(ChatServerError):
    code = "dm_capacity_exceeded"


class DmSelfTargetError(ChatServerError):
    code = "dm_self_target"
