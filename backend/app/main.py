from __future__ import annotations

import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.config import Settings
from app.core.filtering import CensoredWordsFilter
from app.core.service import ChatService
from app.errors import ChatServerError, NotConnectedError, ValidationError
from app.storage.repository import SQLiteRepository
from app.storage.writer import AsyncSQLiteWriter
from app.transport.connection_manager import ConnectionManager
from app.transport.protocol import build_error_event, parse_raw_event


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings.from_env()

    logger = logging.getLogger("chat_server")
    logger.setLevel(active_settings.log_level.upper())
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    app = FastAPI(title="Chat Server")

    repository = SQLiteRepository(active_settings.db_path)
    connection_manager = ConnectionManager()
    writer = AsyncSQLiteWriter(repository=repository, logger=logger)
    message_filter = CensoredWordsFilter(active_settings.banned_words)
    service = ChatService(
        settings=active_settings,
        connection_manager=connection_manager,
        repository=repository,
        writer=writer,
        message_filter=message_filter,
        logger=logger,
    )

    app.state.settings = active_settings
    app.state.chat_service = service
    app.state.sqlite_writer = writer
    app.state.repository = repository
    app.state.logger = logger

    @app.on_event("startup")
    async def on_startup() -> None:
        repository.init_db()
        await writer.start()
        logger.info("Chat server startup complete")

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        await writer.stop()
        logger.info("Chat server shutdown complete")

    @app.get("/")
    async def root() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        user_id: str | None = None

        try:
            while True:
                raw_message = await websocket.receive_text()

                try:
                    event = parse_raw_event(
                        raw_message,
                        default_limit=active_settings.history_default_limit,
                        max_limit=active_settings.history_max_limit,
                    )
                except ChatServerError as exc:
                    await websocket.send_text(json.dumps(build_error_event(exc.code, exc.message), ensure_ascii=False))
                    service.enqueue_error_event(user_id=None, error_code=exc.code, message=exc.message)
                    continue

                if event.event_type == "connect":
                    if user_id is not None:
                        exc = ValidationError("Session is already connected")
                        await websocket.send_text(
                            json.dumps(build_error_event(exc.code, exc.message), ensure_ascii=False)
                        )
                        service.enqueue_error_event(user_id=user_id, error_code=exc.code, message=exc.message)
                        continue
                    try:
                        user_id = await service.handle_connect(event.payload, websocket)
                    except ChatServerError as exc:
                        await websocket.send_text(
                            json.dumps(build_error_event(exc.code, exc.message), ensure_ascii=False)
                        )
                        service.enqueue_error_event(user_id=None, error_code=exc.code, message=exc.message)
                    continue

                if user_id is None:
                    exc = NotConnectedError("Please send 'connect' event first")
                    await websocket.send_text(json.dumps(build_error_event(exc.code, exc.message), ensure_ascii=False))
                    service.enqueue_error_event(user_id=None, error_code=exc.code, message=exc.message)
                    continue

                try:
                    await service.handle_event(user_id, event)
                except ChatServerError as exc:
                    await websocket.send_text(json.dumps(build_error_event(exc.code, exc.message), ensure_ascii=False))
                    service.enqueue_error_event(user_id=user_id, error_code=exc.code, message=exc.message)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        finally:
            if user_id is not None:
                await service.disconnect_user(user_id)

    return app


app = create_app()
