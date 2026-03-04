from __future__ import annotations

from contextlib import ExitStack
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import unittest
from urllib.request import urlopen
from uuid import uuid4

from websockets.sync.client import connect


class WebSocketFlowTests(unittest.TestCase):
    def setUp(self):
        self.backend_dir = Path(__file__).resolve().parent.parent
        self.runtime_dir = self.backend_dir / "tests_runtime"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.runtime_dir / f"flow_{uuid4().hex}.db"
        self.port = self._pick_free_port()
        self.server = self._start_server(self.backend_dir, self.port, self.db_path)

    def tearDown(self):
        if self.server.poll() is None:
            self.server.terminate()
            try:
                self.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait(timeout=5)
        for _ in range(20):
            if not self.db_path.exists():
                return
            try:
                self.db_path.unlink()
                return
            except PermissionError:
                time.sleep(0.05)

    def test_invalid_json_returns_error(self):
        with self._open_ws() as ws:
            ws.send("not-json")
            event = self._recv_until(ws, lambda candidate: candidate.get("type") == "error")
            self.assertEqual(event["payload"]["error_code"], "invalid_json")

    def test_room_join_send_and_history(self):
        with self._open_ws() as alice_ws, self._open_ws() as bob_ws:
            self._connect(alice_ws, "alice")
            self._connect(bob_ws, "bob")

            self._send_event(alice_ws, "create_room", {"title": "General"})
            created_room = self._recv_until(alice_ws, lambda event: event.get("type") == "chat_upsert")
            chat_id = created_room["chat_id"]

            self._send_event(bob_ws, "join_room", chat_id=chat_id)
            self._recv_until(
                bob_ws,
                lambda event: event.get("type") == "chat_upsert" and event.get("chat_id") == chat_id,
            )

            self._send_event(alice_ws, "send_message", {"content": "hello badword"}, chat_id=chat_id)
            received = self._recv_until(
                bob_ws,
                lambda event: event.get("type") == "message"
                and event.get("chat_id") == chat_id
                and event["payload"]["kind"] == "text",
            )
            self.assertEqual(received["payload"]["content"], "hello ***")

            self._send_event(bob_ws, "history_request", chat_id=chat_id, limit=20)
            history = self._recv_until(
                bob_ws,
                lambda event: event.get("type") == "history_response" and event.get("chat_id") == chat_id,
            )
            self.assertTrue(history["payload"]["messages"])

    def test_reconnect_preserves_membership(self):
        with self._open_ws() as ws:
            self._connect(ws, "reconnect-user")
            self._send_event(ws, "create_room", {"title": "Reconnect Room"})
            chat_upsert = self._recv_until(ws, lambda event: event.get("type") == "chat_upsert")
            chat_id = chat_upsert["chat_id"]
            self._send_event(ws, "send_message", {"content": "ping"}, chat_id=chat_id)
            self._recv_until(
                ws,
                lambda event: event.get("type") == "message"
                and event.get("chat_id") == chat_id
                and event["payload"]["kind"] == "text",
            )

        with self._open_ws() as ws_reconnected:
            self._connect(ws_reconnected, "reconnect-user")
            # _connect() already consumed the initial chat_list, so request an explicit refresh.
            self._send_event(ws_reconnected, "history_request", chat_id=chat_id, limit=20)
            history = self._recv_until(
                ws_reconnected,
                lambda event: event.get("type") == "history_response" and event.get("chat_id") == chat_id,
            )
            self.assertTrue(any(msg["content"] == "ping" for msg in history["payload"]["messages"]))

    def test_handles_ten_websocket_clients(self):
        with ExitStack() as stack:
            sockets = [stack.enter_context(self._open_ws()) for _ in range(10)]
            for index, ws in enumerate(sockets):
                self._connect(ws, f"user-{index}")

            owner_ws = sockets[0]
            self._send_event(owner_ws, "create_room", {"title": "Load Room"})
            chat_upsert = self._recv_until(owner_ws, lambda event: event.get("type") == "chat_upsert")
            chat_id = chat_upsert["chat_id"]

            for ws in sockets[1:]:
                self._send_event(ws, "join_room", chat_id=chat_id)
                self._recv_until(
                    ws,
                    lambda event: event.get("type") == "chat_upsert" and event.get("chat_id") == chat_id,
                )

            self._send_event(owner_ws, "send_message", {"content": "load test message"}, chat_id=chat_id)
            for ws in sockets:
                incoming = self._recv_until(
                    ws,
                    lambda event: event.get("type") == "message"
                    and event.get("chat_id") == chat_id
                    and event["payload"]["kind"] == "text"
                    and event["payload"]["content"] == "load test message",
                )
                self.assertEqual(incoming["payload"]["content"], "load test message")

    def test_search_catalog_returns_mixed_results_and_skips_self(self):
        with self._open_ws() as alex_ws, self._open_ws() as alice_ws:
            alex_connected = self._connect(alex_ws, "alex")
            self._connect(alice_ws, "alice")

            self._send_event(alice_ws, "create_room", {"title": "Alpha Team"})
            self._recv_until(alice_ws, lambda event: event.get("type") == "chat_upsert")

            self._send_event(alex_ws, "search_catalog", {"query": "al", "limit": 20})
            search_results = self._recv_until(
                alex_ws,
                lambda event: event.get("type") == "search_results" and event["payload"]["query"] == "al",
            )
            results = search_results["payload"]["results"]

            self.assertTrue(
                any(
                    item["kind"] == "room"
                    and item["title"] == "Alpha Team"
                    and item["action"] == "join_room"
                    and item["is_member"] is False
                    for item in results
                )
            )
            self.assertTrue(
                any(
                    item["kind"] == "user"
                    and item["username"] == "alice"
                    and item["action"] == "open_dm"
                    and item["is_member"] is False
                    for item in results
                )
            )
            self.assertFalse(
                any(
                    item["kind"] == "user"
                    and item.get("user_id") == alex_connected["payload"]["user_id"]
                    for item in results
                )
            )

    def test_search_results_allow_join_room_and_open_dm(self):
        with self._open_ws() as owner_ws, self._open_ws() as seeker_ws, self._open_ws() as target_ws:
            self._connect(owner_ws, "owner")
            self._connect(seeker_ws, "seeker")
            target_connected = self._connect(target_ws, "target")

            self._send_event(owner_ws, "create_room", {"title": "Arena"})
            room_upsert = self._recv_until(owner_ws, lambda event: event.get("type") == "chat_upsert")
            room_id = room_upsert["chat_id"]

            self._send_event(seeker_ws, "search_catalog", {"query": "ar", "limit": 20})
            room_results = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "search_results" and event["payload"]["query"] == "ar",
            )
            room_result = next(item for item in room_results["payload"]["results"] if item["kind"] == "room")
            self.assertEqual(room_result["action"], "join_room")

            self._send_event(seeker_ws, "join_room", chat_id=room_result["chat_id"])
            joined_room = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "chat_upsert" and event.get("chat_id") == room_id,
            )
            self.assertTrue(joined_room["payload"]["chat"]["is_member"])

            self._send_event(seeker_ws, "history_request", chat_id=room_id, limit=20)
            room_history = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "history_response" and event.get("chat_id") == room_id,
            )
            self.assertTrue(room_history["payload"]["messages"])

            self._send_event(seeker_ws, "search_catalog", {"query": "ar", "limit": 20})
            room_results_after_join = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "search_results" and event["payload"]["query"] == "ar",
            )
            room_result_after_join = next(
                item for item in room_results_after_join["payload"]["results"] if item["kind"] == "room"
            )
            self.assertEqual(room_result_after_join["action"], "open")

            self._send_event(seeker_ws, "search_catalog", {"query": "tar", "limit": 20})
            user_results = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "search_results" and event["payload"]["query"] == "tar",
            )
            user_result = next(item for item in user_results["payload"]["results"] if item["kind"] == "user")
            self.assertEqual(user_result["action"], "open_dm")

            self._send_event(seeker_ws, "open_dm", {"username": user_result["username"]})
            dm_upsert = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "chat_upsert"
                and event["payload"]["chat"]["type"] == "dm"
                and any(
                    member["user_id"] == target_connected["payload"]["user_id"]
                    for member in event["payload"]["chat"]["members"]
                ),
            )
            dm_chat_id = dm_upsert["chat_id"]

            self._send_event(seeker_ws, "history_request", chat_id=dm_chat_id, limit=20)
            dm_history = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "history_response" and event.get("chat_id") == dm_chat_id,
            )
            self.assertTrue(dm_history["payload"]["messages"])

            self._send_event(seeker_ws, "search_catalog", {"query": "tar", "limit": 20})
            user_results_after_open = self._recv_until(
                seeker_ws,
                lambda event: event.get("type") == "search_results" and event["payload"]["query"] == "tar",
            )
            user_result_after_open = next(
                item for item in user_results_after_open["payload"]["results"] if item["kind"] == "user"
            )
            self.assertEqual(user_result_after_open["action"], "open")
            self.assertEqual(user_result_after_open["chat_id"], dm_chat_id)

    def _open_ws(self):
        return connect(f"ws://127.0.0.1:{self.port}/ws")

    @staticmethod
    def _send_event(ws, event_type: str, payload: dict | None = None, chat_id: str | None = None, **extra) -> None:
        body = {"type": event_type, "payload": payload or {}}
        if chat_id is not None:
            body["chat_id"] = chat_id
        body.update(extra)
        ws.send(json.dumps(body, ensure_ascii=False))

    @staticmethod
    def _recv_until(ws, matcher, max_messages: int = 260):
        for _ in range(max_messages):
            event = json.loads(ws.recv(timeout=5))
            if matcher(event):
                return event
        raise AssertionError("Expected event not received in allotted messages")

    def _connect(self, ws, username: str) -> dict:
        self._send_event(ws, "connect", {"username": username})
        connected = self._recv_until(ws, lambda event: event.get("type") == "connected")
        self.assertEqual(connected["payload"]["username"], username)
        self._recv_until(ws, lambda event: event.get("type") == "chat_list")
        return connected

    @staticmethod
    def _pick_free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    @staticmethod
    def _start_server(backend_dir: Path, port: int, db_path: Path) -> subprocess.Popen:
        env = os.environ.copy()
        env["CHAT_SERVER_DB_PATH"] = str(db_path)
        env["CHAT_SERVER_LOG_LEVEL"] = "WARNING"
        python_executable = backend_dir / ".venv" / "Scripts" / "python.exe"

        process = subprocess.Popen(
            [str(python_executable), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=backend_dir,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        deadline = time.time() + 12
        url = f"http://127.0.0.1:{port}/"
        while time.time() < deadline:
            try:
                with urlopen(url, timeout=1):
                    return process
            except Exception:
                if process.poll() is not None:
                    break
                time.sleep(0.1)

        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        raise RuntimeError("Failed to start uvicorn server for tests")


if __name__ == "__main__":
    unittest.main()
