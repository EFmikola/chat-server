import { useEffect, useRef, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws";

function App() {
  const wsRef = useRef(null);
  const [status, setStatus] = useState("disconnected");
  const [usernameInput, setUsernameInput] = useState("");
  const [sessionUsername, setSessionUsername] = useState("");
  const [errorText, setErrorText] = useState("");

  const connect = (inputUsername) => {
    const username = inputUsername.trim();
    if (!username) {
      setErrorText("Username is required");
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus("connecting");
    setErrorText("");
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "connect", payload: { username } }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") {
          setSessionUsername(data.payload?.username ?? username);
          setStatus("connected");
        }
      } catch {
        setErrorText("Failed to parse server payload");
      }
    };

    socket.onclose = () => {
      setStatus("disconnected");
    };

    socket.onerror = () => {
      setStatus("disconnected");
      setErrorText("WebSocket connection failed");
    };
  };

  const onConnectSubmit = (event) => {
    event.preventDefault();
    connect(usernameInput);
  };

  const onReconnect = () => {
    if (!sessionUsername) {
      setErrorText("No previous session to reconnect");
      return;
    }
    connect(sessionUsername);
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="status-line">
          <span className={`status-dot status-${status}`} />
          <span className="status-text">
            {status === "connected" ? "Connected" : status === "connecting" ? "Connecting" : "Disconnected"}
          </span>
        </div>
        <div className="session-meta">
          <span className="session-user">{sessionUsername || "Guest"}</span>
          <button type="button" className="ghost-button" onClick={onReconnect}>
            Reconnect
          </button>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <form className="connect-form" onSubmit={onConnectSubmit}>
            <label htmlFor="username-input">Username</label>
            <div className="input-row">
              <input
                id="username-input"
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                placeholder="Enter username"
                autoComplete="off"
              />
              <button type="submit">Connect</button>
            </div>
          </form>

          <div className="chat-list-wrap">
            <div className="chat-list-title">Chats</div>
            <div className="chat-list">
              <div className="empty-hint">Chat list will appear here</div>
            </div>
          </div>
        </aside>

        <section className="chat-panel">
          <div className="chat-panel-head">
            <div className="chat-panel-title">Select chat</div>
          </div>
          <div className="messages">
            <div className="empty-hint">Message stream will appear here</div>
          </div>
          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <input placeholder="Message input is disabled in shell stage" disabled autoComplete="off" />
            <button type="submit" disabled>
              Send
            </button>
          </form>
        </section>
      </main>

      {errorText ? <div className="error-banner">{errorText}</div> : null}
    </div>
  );
}

export default App;