from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


DEFAULT_BANNED_WORDS: tuple[str, ...] = ("badword", "uglyword", "spam")


def _read_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _read_words_env(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if raw is None:
        return default
    words = tuple(part.strip() for part in raw.split(",") if part.strip())
    return words if words else default


@dataclass(frozen=True, slots=True)
class Settings:
    db_path: Path
    message_history_limit: int = 200
    history_default_limit: int = 50
    history_max_limit: int = 100
    banned_words: tuple[str, ...] = DEFAULT_BANNED_WORDS
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "Settings":
        db_path = Path(os.getenv("CHAT_SERVER_DB_PATH", "data/chat_server.db"))
        return cls(
            db_path=db_path,
            message_history_limit=max(10, _read_int_env("CHAT_SERVER_HISTORY_LIMIT", 200)),
            history_default_limit=max(1, _read_int_env("CHAT_SERVER_HISTORY_DEFAULT_LIMIT", 50)),
            history_max_limit=max(1, _read_int_env("CHAT_SERVER_HISTORY_MAX_LIMIT", 100)),
            banned_words=_read_words_env("CHAT_SERVER_BANNED_WORDS", DEFAULT_BANNED_WORDS),
            log_level=os.getenv("CHAT_SERVER_LOG_LEVEL", "INFO"),
        )
