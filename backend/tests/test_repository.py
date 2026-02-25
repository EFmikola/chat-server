from datetime import timedelta
from pathlib import Path
import time
import unittest
from uuid import uuid4

from app.domain.models import Message, utc_now
from app.storage.repository import SQLiteRepository


class SQLiteRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.runtime_dir = Path("tests_runtime")
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.runtime_dir / f"repo_test_{uuid4().hex}.db"
        self.repository = SQLiteRepository(self.db_path)
        self.repository.init_db()

    def tearDown(self):
        for _ in range(10):
            if not self.db_path.exists():
                return
            try:
                self.db_path.unlink()
                return
            except PermissionError:
                time.sleep(0.05)
                continue

    def test_insert_and_paginate_messages(self):
        first = Message.create(chat_id="chat-1", sender_username="alice", content="one")
        second = Message.create(chat_id="chat-1", sender_username="alice", content="two")
        third = Message.create(chat_id="chat-1", sender_username="alice", content="three")

        self.repository.insert_message(first)
        self.repository.insert_message(second)
        self.repository.insert_message(third)
        self.repository.insert_event("send_message", "alice", "chat-1", {"message_id": third.id}, utc_now())

        page_one, has_more = self.repository.fetch_messages_page(chat_id="chat-1", before=None, limit=2)
        self.assertEqual(len(page_one), 2)
        self.assertTrue(has_more)
        self.assertEqual(page_one[0].content, "two")
        self.assertEqual(page_one[1].content, "three")

        before = page_one[0].created_at + timedelta(microseconds=1)
        page_two, has_more_two = self.repository.fetch_messages_page(chat_id="chat-1", before=before, limit=2)
        self.assertEqual([item.content for item in page_two], ["one", "two"])
        self.assertFalse(has_more_two)


if __name__ == "__main__":
    unittest.main()
