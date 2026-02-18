from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json
from datetime import datetime, timezone

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "ok"}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()

            # 1) безопасный парсинг JSON
            try:
                data = json.loads(raw)
                msg_type = data.get("type")
                payload = data.get("payload", {})
            except Exception:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "payload": {"message": "invalid_json"},
                    "ts": datetime.now(timezone.utc).isoformat()
                }))
                continue

            # 2) пока сделаем простую обработку connect + echo
            if msg_type == "connect":
                username = payload.get("username")
                await ws.send_text(json.dumps({
                    "type": "connected",
                    "payload": {"username": username},
                    "ts": datetime.now(timezone.utc).isoformat()
                }))
            elif msg_type == "echo":
                await ws.send_text(json.dumps({
                    "type": "echo",
                    "payload": {"text": payload.get("text", "")},
                    "ts": datetime.now(timezone.utc).isoformat()
                }))
            else:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "payload": {"message": "unknown_type", "type": msg_type},
                    "ts": datetime.now(timezone.utc).isoformat()
                }))

    except WebSocketDisconnect:
        pass
