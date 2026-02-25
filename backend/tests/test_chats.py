import unittest

from app.core.chats import GroupChat, PrivateChat
from app.domain.models import Message
from app.errors import DmCapacityError


class ChatEntityTests(unittest.TestCase):
    def test_private_chat_disallows_third_member(self):
        chat = PrivateChat(chat_id="dm-1", history_limit=10, user_one_id="u1", user_two_id="u2")

        with self.assertRaises(DmCapacityError):
            chat.add_member("u3")

    def test_group_chat_message_history_uses_fifo_limit(self):
        chat = GroupChat(chat_id="room-1", title="General", history_limit=2)
        chat.add_member("u1")

        chat.append_message(Message.create("room-1", "u1", "first"))
        chat.append_message(Message.create("room-1", "u1", "second"))
        chat.append_message(Message.create("room-1", "u1", "third"))

        history = chat.message_history
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0].content, "second")
        self.assertEqual(history[1].content, "third")


if __name__ == "__main__":
    unittest.main()
