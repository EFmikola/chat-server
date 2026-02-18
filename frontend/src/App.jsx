import { useEffect, useRef, useState } from "react";

export default function App() {
  const wsRef = useRef(null);
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState("");
  const username = "Kolya"; // позже сделаем ввод в UI

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      setLog((l) => ["ws:open", ...l]);

      ws.send(
        JSON.stringify({
          type: "connect",
          payload: { username },
        })
      );
    };

    ws.onmessage = (e) => {
      setLog((l) => [e.data, ...l]);
    };

    ws.onclose = () => {
      setLog((l) => ["ws:close", ...l]);
    };

    return () => ws.close();
  }, []);

  const send = () => {
    if (!msg.trim()) return;

    wsRef.current?.send(
      JSON.stringify({
        type: "echo",
        payload: { text: msg },
      })
    );

    setMsg("");
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>JSON WS test</h2>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="type message..."
        />
        <button onClick={send}>Send</button>
      </div>

      <pre style={{ marginTop: 15 }}>{log.join("\n")}</pre>
    </div>
  );
}
