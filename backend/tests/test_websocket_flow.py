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
        self.runtime_dir = Path("tests_runtime")
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.runtime_dir / f"flow_{uuid4().hex}.db"
        self.port = self._pick_free_port()
        self.server = self._start_server(self.port, self.db_path)

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

    def _connect(self, ws, username: str) -> None:
        self._send_event(ws, "connect", {"username": username})
        connected = self._recv_until(ws, lambda event: event.get("type") == "connected")
        self.assertEqual(connected["payload"]["username"], username)
        self._recv_until(ws, lambda event: event.get("type") == "chat_list")

    @staticmethod
    def _pick_free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    @staticmethod
    def _start_server(port: int, db_path: Path) -> subprocess.Popen:
        env = os.environ.copy()
        env["CHAT_SERVER_DB_PATH"] = str(db_path)
        env["CHAT_SERVER_LOG_LEVEL"] = "WARNING"

        process = subprocess.Popen(
            [".\\.venv\\Scripts\\python", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=".",
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
