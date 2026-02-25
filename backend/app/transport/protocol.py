from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json

from app.domain.models import utc_now
from app.errors import InvalidJSONError, ValidationError


@dataclass(slots=True)
class InboundEvent:
    event_type: str
    chat_id: str | None
    payload: dict
    before: datetime | None
    limit: int | None


def parse_raw_event(raw_message: str, default_limit: int, max_limit: int) -> InboundEvent:
    try:
        data = json.loads(raw_message)
    except json.JSONDecodeError as exc:
        raise InvalidJSONError("Incoming payload is not valid JSON") from exc

    if not isinstance(data, dict):
        raise ValidationError("Top-level payload must be a JSON object")

    event_type = data.get("type")
    if not isinstance(event_type, str) or not event_type.strip():
        raise ValidationError("Field 'type' is required and must be a non-empty string")

    payload = data.get("payload", {})
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ValidationError("Field 'payload' must be an object")

    chat_id = data.get("chat_id", payload.get("chat_id"))
    if chat_id is not None and not isinstance(chat_id, str):
        raise ValidationError("Field 'chat_id' must be a string")

    before = None
    limit = None
    if event_type == "history_request":
        before_raw = data.get("before", payload.get("before"))
        if before_raw is not None:
            if not isinstance(before_raw, str):
                raise ValidationError("Field 'before' must be an ISO timestamp string")
            try:
                before = datetime.fromisoformat(before_raw)
            except ValueError as exc:
                raise ValidationError("Field 'before' must be a valid ISO timestamp") from exc

        limit_raw = data.get("limit", payload.get("limit", default_limit))
        if not isinstance(limit_raw, int):
            raise ValidationError("Field 'limit' must be an integer")
        if limit_raw < 1 or limit_raw > max_limit:
            raise ValidationError(f"Field 'limit' must be in range 1..{max_limit}")
        limit = limit_raw

    return InboundEvent(
        event_type=event_type.strip(),
        chat_id=chat_id,
        payload=payload,
        before=before,
        limit=limit,
    )


def build_event(event_type: str, payload: dict, chat_id: str | None = None) -> dict:
    event = {
        "type": event_type,
        "payload": payload,
        "ts": utc_now().isoformat(),
    }
    if chat_id is not None:
        event["chat_id"] = chat_id
    return event


def build_error_event(error_code: str, message: str, details: dict | None = None) -> dict:
    payload = {"error_code": error_code, "message": message}
    if details:
        payload["details"] = details
    return build_event("error", payload=payload)
