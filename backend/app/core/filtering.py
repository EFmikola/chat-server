from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Protocol


class TextFilter(Protocol):
    def apply(self, text: str) -> str:
        ...


@dataclass(slots=True)
class CensoredWordsFilter:
    banned_words: tuple[str, ...]

    def apply(self, text: str) -> str:
        filtered = text
        for word in self.banned_words:
            pattern = re.compile(rf"\b{re.escape(word)}\b", flags=re.IGNORECASE)
            filtered = pattern.sub("***", filtered)
        return filtered
