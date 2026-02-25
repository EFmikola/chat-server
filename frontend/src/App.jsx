import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws";

function sortChats(chats) {
  return [...chats].sort((left, right) => {
    const leftTs = left.last_message_at ? Date.parse(left.last_message_at) : 0;
    const rightTs = right.last_message_at ? Date.parse(right.last_message_at) : 0;
    return rightTs - leftTs;
  });
}

function mergeMessages(existing = [], incoming = []) {
  const byId = new Map();
  [...existing, ...incoming].forEach((message) => {
    byId.set(message.id, message);
  });

  return [...byId.values()].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

function upsertChat(chats, nextChat) {
  const index = chats.findIndex((chat) => chat.id === nextChat.id);
  if (index === -1) {
    return sortChats([nextChat, ...chats]);
  }
  const copy = [...chats];
  copy[index] = { ...copy[index], ...nextChat };
  return sortChats(copy);
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function App() {
  const wsRef = useRef(null);
  const [status, setStatus] = useState("disconnected");
  const [usernameInput, setUsernameInput] = useState("");
  const [sessionUsername, setSessionUsername] = useState("");
  const [sessionUserId, setSessionUserId] = useState("");
  const [roomTitle, setRoomTitle] = useState("");
  const [dmTarget, setDmTarget] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messagesByChat, setMessagesByChat] = useState({});
  const [errorText, setErrorText] = useState("");

  const sendEvent = (type, payload = {}, extra = {}) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify({ type, payload, ...extra }));
    return true;
  };

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );
  const selectedMessages = useMemo(() => messagesByChat[selectedChatId] ?? [], [messagesByChat, selectedChatId]);
  const canSendMessage = status === "connected" && Boolean(selectedChatId);

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
          setSessionUserId(data.payload?.user_id ?? "");
          setStatus("connected");
          return;
        }

        if (data.type === "chat_list") {
          const nextChats = sortChats(data.payload?.chats ?? []);
          setChats(nextChats);
          setSelectedChatId((prev) => {
            if (prev && nextChats.some((chat) => chat.id === prev)) {
              return prev;
            }
            return nextChats[0]?.id ?? "";
          });
          return;
        }

        if (data.type === "chat_upsert" && data.payload?.chat) {
          setChats((prev) => upsertChat(prev, data.payload.chat));
          setSelectedChatId((prev) => prev || data.payload.chat.id);
          return;
        }

        if (data.type === "presence_update") {
          const online = data.payload?.online_user_ids ?? [];
          setChats((prev) =>
            prev.map((chat) => (chat.id === data.chat_id ? { ...chat, online_user_ids: online } : chat)),
          );
          return;
        }

        if (data.type === "message" && data.chat_id && data.payload) {
          const chatId = data.chat_id;
          const message = data.payload;
          setMessagesByChat((prev) => ({
            ...prev,
            [chatId]: mergeMessages(prev[chatId], [message]),
          }));
          setChats((prev) =>
            sortChats(
              prev.map((chat) =>
                chat.id === chatId
                  ? {
                      ...chat,
                      last_message_at: message.created_at,
                      last_message_preview: message.content,
                    }
                  : chat,
              ),
            ),
          );
          return;
        }

        if (data.type === "error") {
          const message = data.payload?.message ?? "Unknown server error";
          const errorCode = data.payload?.error_code ?? "error";
          setErrorText(`${errorCode}: ${message}`);
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

  const onCreateRoom = (event) => {
    event.preventDefault();
    const title = roomTitle.trim();
    if (!title) {
      return;
    }
    sendEvent("create_room", { title });
    setRoomTitle("");
  };

  const onOpenDm = (event) => {
    event.preventDefault();
    const username = dmTarget.trim();
    if (!username) {
      return;
    }
    sendEvent("open_dm", { username });
    setDmTarget("");
  };

  const onJoinRoom = (event) => {
    event.preventDefault();
    const chatId = joinRoomId.trim();
    if (!chatId) {
      return;
    }
    sendEvent("join_room", {}, { chat_id: chatId });
    setJoinRoomId("");
  };

  const onLeaveRoom = () => {
    if (!selectedChat) {
      return;
    }
    sendEvent("leave_room", {}, { chat_id: selectedChat.id });
  };

  const onSendMessage = (event) => {
    event.preventDefault();
    if (!canSendMessage) {
      return;
    }
    const content = messageInput.trim();
    if (!content) {
      return;
    }
    sendEvent("send_message", { content }, { chat_id: selectedChatId });
    setMessageInput("");
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
          <span className="session-user">{sessionUsername ? `${sessionUsername} (${sessionUserId.slice(0, 8)})` : "Guest"}</span>
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

          <form className="tool-form" onSubmit={onCreateRoom}>
            <label htmlFor="room-input">Create Room</label>
            <div className="input-row">
              <input
                id="room-input"
                value={roomTitle}
                onChange={(event) => setRoomTitle(event.target.value)}
                placeholder="Room title"
                autoComplete="off"
              />
              <button type="submit">Create</button>
            </div>
          </form>

          <form className="tool-form" onSubmit={onOpenDm}>
            <label htmlFor="dm-input">Open DM</label>
            <div className="input-row">
              <input
                id="dm-input"
                value={dmTarget}
                onChange={(event) => setDmTarget(event.target.value)}
                placeholder="Username"
                autoComplete="off"
              />
              <button type="submit">Open</button>
            </div>
          </form>

          <form className="tool-form" onSubmit={onJoinRoom}>
            <label htmlFor="join-room-input">Join Room by ID</label>
            <div className="input-row">
              <input
                id="join-room-input"
                value={joinRoomId}
                onChange={(event) => setJoinRoomId(event.target.value)}
                placeholder="chat_id"
                autoComplete="off"
              />
              <button type="submit">Join</button>
            </div>
          </form>

          <div className="chat-list-wrap">
            <div className="chat-list-title">Chats</div>
            <div className="chat-list">
              {chats.length === 0 ? <div className="empty-hint">No chats yet</div> : null}
              {chats.map((chat) => {
                const isActive = chat.id === selectedChatId;
                return (
                  <button
                    type="button"
                    className={`chat-card${isActive ? " active" : ""}`}
                    key={chat.id}
                    onClick={() => setSelectedChatId(chat.id)}
                  >
                    <div className="chat-card-top">
                      <span className="chat-title">{chat.title}</span>
                      <span className="chat-time">{formatTimestamp(chat.last_message_at)}</span>
                    </div>
                    <div className="chat-card-bottom">
                      <span className="chat-preview">{chat.last_message_preview || "No messages yet"}</span>
                      <span className="chat-kind">{chat.type === "dm" ? "DM" : "ROOM"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="chat-panel">
          <div className="chat-panel-head">
            <div className="chat-panel-title">{selectedChat ? selectedChat.title : "Select chat"}</div>
            <div className="chat-panel-meta">
              {selectedChat ? (
                <span>
                  Online: {selectedChat.online_user_ids?.length ?? 0} / {selectedChat.member_ids?.length ?? 0}
                </span>
              ) : null}
              <button type="button" className="ghost-button" onClick={onLeaveRoom} disabled={!selectedChat}>
                Leave
              </button>
            </div>
          </div>

          <div className="messages">
            {selectedMessages.length === 0 ? <div className="empty-hint">No messages</div> : null}
            {selectedMessages.map((message) => (
              <article
                key={message.id}
                className={`message-item${message.kind === "system" ? " system" : ""}${
                  message.sender_username === sessionUsername ? " own" : ""
                }`}
              >
                <div className="message-meta">
                  <span className="message-author">{message.sender_username}</span>
                  <span className="message-time">{formatTimestamp(message.created_at)}</span>
                </div>
                <div className="message-content">{message.content}</div>
              </article>
            ))}
          </div>

          <form className="composer" onSubmit={onSendMessage}>
            <input
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder={canSendMessage ? "Type a message..." : "Connect and select chat"}
              disabled={!canSendMessage}
              autoComplete="off"
            />
            <button type="submit" disabled={!canSendMessage}>
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