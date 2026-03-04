import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import ChatWorkspace from "./components/ChatWorkspace";
import LoginScreen from "./components/LoginScreen";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws";
const HISTORY_LIMIT = 50;
const SEARCH_LIMIT = 20;

const ERROR_TRANSLATIONS = {
  "Unknown server error": "Неизвестная ошибка сервера",
  "Field 'payload.username' is required": "Поле имени пользователя обязательно",
  "Username cannot be empty": "Имя пользователя не может быть пустым",
  "Username is too long": "Имя пользователя слишком длинное",
  "Field 'payload.title' is required": "Нужно указать название комнаты",
  "Room title cannot be empty": "Название комнаты не может быть пустым",
  "Room title is too long": "Название комнаты слишком длинное",
  "Join operation is available only for rooms": "Войти можно только в комнату",
  "Leave operation is available only for rooms": "Покинуть можно только комнату",
  "Target username cannot be empty": "Нужно указать имя собеседника",
  "Field 'payload.content' is required": "Поле сообщения обязательно",
  "Message cannot be empty": "Сообщение не может быть пустым",
  "Field 'chat_id' is required": "Нужно указать ID чата",
  "Unknown user": "Пользователь не найден",
  "Field 'payload.query' is required": "Нужно указать строку поиска",
  "Field 'payload.limit' must be an integer": "Лимит поиска должен быть числом",
  "Field 'payload.limit' must be in range 1..20": "Лимит поиска должен быть в диапазоне от 1 до 20",
  "Please send 'connect' event first": "Сначала нужно подключиться к серверу",
  "Session is already connected": "Сессия уже подключена",
  "Cannot open DM with yourself": "Нельзя открыть личный чат с самим собой",
  "User is not a member of this chat": "Вы не состоите в этом чате",
  "User is not a member of this room": "Вы не состоите в этой комнате",
};

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
    const key = message.id ?? `${message.chat_id}:${message.created_at}:${message.sender_username}:${message.content}`;
    byId.set(key, message);
  });

  return [...byId.values()].sort((left, right) => {
    const leftTs = Date.parse(left.created_at ?? "");
    const rightTs = Date.parse(right.created_at ?? "");
    return (Number.isNaN(leftTs) ? 0 : leftTs) - (Number.isNaN(rightTs) ? 0 : rightTs);
  });
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

function syncOpenSearchResult(result, chat) {
  if (result.action !== "open" || result.chat_id !== chat.id) {
    return result;
  }

  return {
    ...result,
    chat_type: chat.type,
    subtitle: chat.type === "dm" ? "Личный чат" : "Группа",
    is_member: true,
    last_message_at: chat.last_message_at ?? null,
    last_message_preview: chat.last_message_preview ?? "",
  };
}

function promoteSearchResultToOpen(result, chat) {
  return {
    ...result,
    action: "open",
    chat_id: chat.id,
    chat_type: chat.type,
    is_member: true,
    subtitle: chat.type === "dm" ? "Личный чат" : "Группа",
    last_message_at: chat.last_message_at ?? null,
    last_message_preview: chat.last_message_preview ?? "",
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusLabel(status) {
  if (status === "connected") {
    return "В сети";
  }
  if (status === "connecting") {
    return "Подключение";
  }
  return "Не в сети";
}

function toPreviewSelection(result) {
  return {
    resultId: result.result_id,
    kind: result.kind,
    chatType: result.chat_type,
    action: result.action,
    chatId: result.chat_id,
    userId: result.user_id,
    username: result.username,
    title: result.title,
    subtitle: result.subtitle,
    memberCount: result.member_count,
  };
}

function App() {
  const wsRef = useRef(null);
  const messagesRef = useRef(null);
  const shouldScrollBottomRef = useRef(true);
  const connectionIdRef = useRef(0);
  const copyTimeoutRef = useRef(null);
  const handleServerEventRef = useRef(() => {});

  const [status, setStatus] = useState("disconnected");
  const [usernameInput, setUsernameInput] = useState("");
  const [sessionUsername, setSessionUsername] = useState("");
  const [sessionUserId, setSessionUserId] = useState("");
  const [hasRecoverableSession, setHasRecoverableSession] = useState(false);

  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messagesByChat, setMessagesByChat] = useState({});
  const [hasMoreByChat, setHasMoreByChat] = useState({});
  const [historyLoadingByChat, setHistoryLoadingByChat] = useState({});

  const [roomTitle, setRoomTitle] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [errorText, setErrorText] = useState("");
  const [copyFeedbackKey, setCopyFeedbackKey] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchOpenCreateGroup, setSearchOpenCreateGroup] = useState(false);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [pendingPreviewConnecting, setPendingPreviewConnecting] = useState(false);
  const [createGroupPendingTitle, setCreateGroupPendingTitle] = useState("");

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );
  const selectedMessages = useMemo(
    () => messagesByChat[selectedChatId] ?? [],
    [messagesByChat, selectedChatId],
  );
  const trimmedSearchQuery = searchQuery.trim();
  const createGroupSubmitting = Boolean(createGroupPendingTitle);
  const canSendMessage = status === "connected" && Boolean(selectedChatId) && !pendingPreview;
  const canLeaveRoom = Boolean(!pendingPreview && selectedChat && selectedChat.type === "room");

  const clearCopyFeedback = useCallback(() => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    setCopyFeedbackKey("");
  }, []);

  const translateUiError = useCallback((rawMessage) => {
    if (!rawMessage) {
      return "Неизвестная ошибка сервера";
    }

    if (ERROR_TRANSLATIONS[rawMessage]) {
      return ERROR_TRANSLATIONS[rawMessage];
    }

    return `Ошибка: ${rawMessage}`;
  }, []);

  const resetChatState = useCallback(() => {
    setChats([]);
    setSelectedChatId("");
    setMessagesByChat({});
    setHasMoreByChat({});
    setHistoryLoadingByChat({});
    setRoomTitle("");
    setMessageInput("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchStatus("idle");
    setSearchOpenCreateGroup(false);
    setPendingPreview(null);
    setPendingPreviewConnecting(false);
    setCreateGroupPendingTitle("");
    shouldScrollBottomRef.current = true;
  }, []);

  const resetSessionState = useCallback(
    ({ clearUsernameInput = false } = {}) => {
      setSessionUsername("");
      setSessionUserId("");
      setHasRecoverableSession(false);
      clearCopyFeedback();
      if (clearUsernameInput) {
        setUsernameInput("");
      }
    },
    [clearCopyFeedback],
  );

  const sendEvent = useCallback((type, payload = {}, extra = {}) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(
      JSON.stringify({
        type,
        payload,
        ...extra,
      }),
    );

    return true;
  }, []);

  const requestHistory = useCallback(
    (chatId, before) => {
      if (!chatId || status !== "connected") {
        return;
      }

      setHistoryLoadingByChat((prev) => ({ ...prev, [chatId]: true }));
      sendEvent("history_request", {}, { chat_id: chatId, before, limit: HISTORY_LIMIT });
    },
    [sendEvent, status],
  );

  const selectChat = useCallback(
    (chatId) => {
      setPendingPreview(null);
      setPendingPreviewConnecting(false);
      setSelectedChatId(chatId);
      if (!chatId) {
        return;
      }
      if (messagesByChat[chatId]?.length || historyLoadingByChat[chatId]) {
        return;
      }
      requestHistory(chatId, undefined);
    },
    [historyLoadingByChat, messagesByChat, requestHistory],
  );

  const handleIncomingMessage = useCallback((event) => {
    const chatId = event.chat_id;
    if (!chatId || !event.payload) {
      return;
    }

    const incoming = event.payload;
    setMessagesByChat((prev) => ({
      ...prev,
      [chatId]: mergeMessages(prev[chatId], [incoming]),
    }));
    setChats((prevChats) =>
      sortChats(
        prevChats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                last_message_at: incoming.created_at,
                last_message_preview: incoming.content,
              }
            : chat,
        ),
      ),
    );
  }, []);

  const handleChatUpsert = useCallback((chat) => {
    setChats((prev) => upsertChat(prev, chat));
  }, []);

  const handleServerEvent = useCallback(
    (event) => {
      if (!event || typeof event !== "object") {
        return;
      }

      if (event.type === "connected") {
        const nextUsername = event.payload?.username ?? "";
        setStatus("connected");
        setSessionUsername(nextUsername);
        setSessionUserId(event.payload?.user_id ?? "");
        setUsernameInput(nextUsername);
        setHasRecoverableSession(false);
        setErrorText("");
        return;
      }

      if (event.type === "chat_list") {
        const nextChats = sortChats(event.payload?.chats ?? []);
        setChats(nextChats);
        if (nextChats.length === 0) {
          setSelectedChatId("");
          return;
        }

        const nextSelectedId =
          selectedChatId && nextChats.some((chat) => chat.id === selectedChatId)
            ? selectedChatId
            : nextChats[0].id;
        setSelectedChatId(nextSelectedId);
        if (!pendingPreview && !messagesByChat[nextSelectedId]?.length && !historyLoadingByChat[nextSelectedId]) {
          requestHistory(nextSelectedId, undefined);
        }
        return;
      }

      if (event.type === "search_results") {
        const responseQuery = (event.payload?.query ?? "").trim();
        if (!trimmedSearchQuery || responseQuery !== trimmedSearchQuery) {
          return;
        }
        setSearchResults(event.payload?.results ?? []);
        setSearchStatus("ready");
        return;
      }

      if (event.type === "chat_upsert") {
        const nextChat = event.payload?.chat;
        if (!nextChat) {
          return;
        }

        handleChatUpsert(nextChat);
        setSearchResults((prev) => prev.map((result) => syncOpenSearchResult(result, nextChat)));

        if (createGroupPendingTitle && nextChat.type === "room" && nextChat.title === createGroupPendingTitle) {
          setCreateGroupPendingTitle("");
          setSearchOpenCreateGroup(false);
          setRoomTitle("");
          setSearchQuery("");
          setSearchResults([]);
          setSearchStatus("idle");
          selectChat(nextChat.id);
          return;
        }

        if (pendingPreview) {
          if (pendingPreview.action === "join_room" && pendingPreview.chatId === nextChat.id) {
            setSearchResults((prev) =>
              prev.map((result) =>
                result.result_id === pendingPreview.resultId ? promoteSearchResultToOpen(result, nextChat) : result,
              ),
            );
            setPendingPreview(null);
            setPendingPreviewConnecting(false);
            selectChat(nextChat.id);
            return;
          }

          if (
            pendingPreview.action === "open_dm" &&
            nextChat.type === "dm" &&
            nextChat.members?.some((member) => member.user_id === pendingPreview.userId)
          ) {
            setSearchResults((prev) =>
              prev.map((result) =>
                result.result_id === pendingPreview.resultId ? promoteSearchResultToOpen(result, nextChat) : result,
              ),
            );
            setPendingPreview(null);
            setPendingPreviewConnecting(false);
            selectChat(nextChat.id);
            return;
          }
        }

        if (!selectedChatId) {
          selectChat(nextChat.id);
        }
        return;
      }

      if (event.type === "presence_update") {
        const online = event.payload?.online_user_ids ?? [];
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === event.chat_id ? { ...chat, online_user_ids: online } : chat,
          ),
        );
        return;
      }

      if (event.type === "message") {
        handleIncomingMessage(event);
        return;
      }

      if (event.type === "history_response") {
        const chatId = event.chat_id;
        const incoming = event.payload?.messages ?? [];
        const hasMore = Boolean(event.payload?.has_more);

        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: mergeMessages(prev[chatId], incoming),
        }));
        setHasMoreByChat((prev) => ({ ...prev, [chatId]: hasMore }));
        setHistoryLoadingByChat((prev) => ({ ...prev, [chatId]: false }));
        return;
      }

      if (event.type === "error") {
        if (pendingPreviewConnecting) {
          setPendingPreviewConnecting(false);
        }
        if (createGroupSubmitting) {
          setCreateGroupPendingTitle("");
        }
        const rawMessage = event.payload?.message ?? "Unknown server error";
        setErrorText(translateUiError(rawMessage));
      }
    },
    [
      createGroupPendingTitle,
      createGroupSubmitting,
      handleChatUpsert,
      handleIncomingMessage,
      historyLoadingByChat,
      messagesByChat,
      pendingPreview,
      pendingPreviewConnecting,
      requestHistory,
      selectChat,
      selectedChatId,
      translateUiError,
      trimmedSearchQuery,
    ],
  );

  useEffect(() => {
    handleServerEventRef.current = handleServerEvent;
  }, [handleServerEvent]);

  const connect = useCallback(
    (targetUsername) => {
      const username = targetUsername.trim();
      if (!username) {
        setErrorText("Введите имя пользователя");
        return;
      }

      const previousSocket = wsRef.current;
      const nextConnectionId = connectionIdRef.current + 1;
      const socket = new WebSocket(WS_URL);

      connectionIdRef.current = nextConnectionId;
      wsRef.current = socket;

      clearCopyFeedback();
      resetChatState();
      setStatus("connecting");
      setUsernameInput(username);
      setErrorText("");

      if (previousSocket && previousSocket !== socket) {
        previousSocket.close();
      }

      socket.onopen = () => {
        if (wsRef.current !== socket || connectionIdRef.current !== nextConnectionId) {
          return;
        }

        socket.send(JSON.stringify({ type: "connect", payload: { username } }));
      };

      socket.onmessage = (messageEvent) => {
        if (wsRef.current !== socket || connectionIdRef.current !== nextConnectionId) {
          return;
        }

        try {
          const parsed = JSON.parse(messageEvent.data);
          handleServerEventRef.current(parsed);
        } catch {
          setErrorText("Получен некорректный ответ сервера");
        }
      };

      socket.onerror = () => {
        if (wsRef.current !== socket || connectionIdRef.current !== nextConnectionId) {
          return;
        }

        setErrorText("Не удалось подключиться к серверу");
      };

      socket.onclose = () => {
        if (wsRef.current !== socket || connectionIdRef.current !== nextConnectionId) {
          return;
        }

        wsRef.current = null;
        resetChatState();
        clearCopyFeedback();
        setStatus("disconnected");
        setSessionUserId("");
        setHasRecoverableSession(Boolean(username));
        setUsernameInput(username);
      };
    },
    [clearCopyFeedback, resetChatState],
  );

  const logoutSession = useCallback(() => {
    const socket = wsRef.current;
    wsRef.current = null;
    connectionIdRef.current += 1;
    if (socket) {
      socket.close();
    }

    setStatus("disconnected");
    resetChatState();
    resetSessionState({ clearUsernameInput: true });
    setErrorText("");
  }, [resetChatState, resetSessionState]);

  const copyToClipboard = useCallback(
    async (value) => {
      if (!value || !navigator.clipboard?.writeText) {
        setErrorText("Не удалось скопировать значение");
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
        clearCopyFeedback();
        setCopyFeedbackKey(value);
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopyFeedbackKey("");
          copyTimeoutRef.current = null;
        }, 1500);
      } catch {
        setErrorText("Не удалось скопировать значение");
      }
    },
    [clearCopyFeedback],
  );

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !selectedChatId || pendingPreview) {
      return;
    }

    if (shouldScrollBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [pendingPreview, selectedChatId, selectedMessages]);

  useEffect(() => {
    if (status !== "connected") {
      return undefined;
    }

    if (!trimmedSearchQuery) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const sent = sendEvent("search_catalog", { query: trimmedSearchQuery, limit: SEARCH_LIMIT });
      if (!sent) {
        setSearchStatus("ready");
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [sendEvent, status, trimmedSearchQuery]);

  useEffect(() => {
    return () => {
      clearCopyFeedback();
      if (wsRef.current) {
        const socket = wsRef.current;
        wsRef.current = null;
        socket.close();
      }
    };
  }, [clearCopyFeedback]);

  const onConnectSubmit = useCallback(
    (event) => {
      event.preventDefault();
      connect(usernameInput || sessionUsername);
    },
    [connect, sessionUsername, usernameInput],
  );

  const onSearchQueryChange = useCallback((value) => {
    setSearchQuery(value);
    if (!value.trim()) {
      setSearchResults([]);
      setSearchStatus("idle");
      return;
    }
    setSearchStatus("loading");
  }, []);

  const onToggleCreateGroup = useCallback(() => {
    setSearchOpenCreateGroup((prev) => {
      if (prev) {
        setRoomTitle("");
        setCreateGroupPendingTitle("");
      }
      return !prev;
    });
  }, []);

  const onCancelCreateGroup = useCallback(() => {
    setSearchOpenCreateGroup(false);
    setRoomTitle("");
    setCreateGroupPendingTitle("");
  }, []);

  const onCreateRoom = useCallback(
    (event) => {
      event.preventDefault();
      const title = roomTitle.trim();
      if (!title) {
        setErrorText("Нужно указать название комнаты");
        return;
      }

      const sent = sendEvent("create_room", { title });
      if (!sent) {
        setErrorText("Не удалось отправить запрос на создание группы");
        return;
      }

      setErrorText("");
      setCreateGroupPendingTitle(title);
    },
    [roomTitle, sendEvent],
  );

  const onSelectSearchResult = useCallback(
    (result) => {
      if (result.action === "open" && result.chat_id) {
        selectChat(result.chat_id);
        return;
      }

      setPendingPreview(toPreviewSelection(result));
      setPendingPreviewConnecting(false);
    },
    [selectChat],
  );

  const onConnectPendingPreview = useCallback(() => {
    if (!pendingPreview) {
      return;
    }

    let sent = false;
    if (pendingPreview.action === "join_room" && pendingPreview.chatId) {
      sent = sendEvent("join_room", {}, { chat_id: pendingPreview.chatId });
    } else if (pendingPreview.action === "open_dm" && pendingPreview.username) {
      sent = sendEvent("open_dm", { username: pendingPreview.username });
    }

    if (!sent) {
      setErrorText("Не удалось отправить запрос на подключение к чату");
      return;
    }

    setErrorText("");
    setPendingPreviewConnecting(true);
  }, [pendingPreview, sendEvent]);

  const onLeaveRoom = useCallback(() => {
    if (!selectedChat || selectedChat.type !== "room") {
      return;
    }
    sendEvent("leave_room", {}, { chat_id: selectedChat.id });
  }, [selectedChat, sendEvent]);

  const onSendMessage = useCallback(
    (event) => {
      event.preventDefault();
      if (!canSendMessage) {
        return;
      }

      const content = messageInput.trim();
      if (!content) {
        setErrorText("Сообщение не может быть пустым");
        return;
      }

      sendEvent("send_message", { content }, { chat_id: selectedChatId });
      setMessageInput("");
    },
    [canSendMessage, messageInput, selectedChatId, sendEvent],
  );

  const onMessagesScroll = useCallback(() => {
    const container = messagesRef.current;
    if (!container || pendingPreview) {
      return;
    }

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldScrollBottomRef.current = distanceToBottom < 32;

    if (container.scrollTop > 24) {
      return;
    }

    if (!selectedChatId || historyLoadingByChat[selectedChatId]) {
      return;
    }
    if (hasMoreByChat[selectedChatId] === false) {
      return;
    }

    const oldestMessage = selectedMessages[0];
    if (!oldestMessage) {
      return;
    }

    requestHistory(selectedChatId, oldestMessage.created_at);
  }, [hasMoreByChat, historyLoadingByChat, pendingPreview, requestHistory, selectedChatId, selectedMessages]);

  return (
    <div className="app-shell">
      {status === "connected" ? (
        <ChatWorkspace
          status={status}
          statusLabel={getStatusLabel(status)}
          sessionUsername={sessionUsername}
          sessionUserId={sessionUserId}
          copyFeedbackKey={copyFeedbackKey}
          onCopy={copyToClipboard}
          onLogout={logoutSession}
          searchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
          searchStatus={searchStatus}
          searchResults={searchResults}
          searchOpenCreateGroup={searchOpenCreateGroup}
          onToggleCreateGroup={onToggleCreateGroup}
          roomTitle={roomTitle}
          onRoomTitleChange={setRoomTitle}
          onCreateRoom={onCreateRoom}
          onCancelCreateGroup={onCancelCreateGroup}
          createGroupSubmitting={createGroupSubmitting}
          chats={chats}
          selectedChat={selectedChat}
          selectedChatId={selectedChatId}
          onSelectChat={selectChat}
          onSelectSearchResult={onSelectSearchResult}
          pendingPreview={pendingPreview}
          pendingPreviewConnecting={pendingPreviewConnecting}
          onConnectPendingPreview={onConnectPendingPreview}
          formatTimestamp={formatTimestamp}
          onLeaveRoom={onLeaveRoom}
          canLeaveRoom={canLeaveRoom}
          messagesRef={messagesRef}
          onMessagesScroll={onMessagesScroll}
          historyLoading={Boolean(selectedChatId && historyLoadingByChat[selectedChatId])}
          selectedMessages={selectedMessages}
          messageInput={messageInput}
          onMessageInputChange={setMessageInput}
          onSendMessage={onSendMessage}
          canSendMessage={canSendMessage}
        />
      ) : (
        <LoginScreen
          usernameInput={usernameInput}
          status={status}
          statusLabel={getStatusLabel(status)}
          errorText={errorText}
          hasRecoverableSession={hasRecoverableSession}
          onUsernameChange={setUsernameInput}
          onSubmit={onConnectSubmit}
        />
      )}

      {errorText && status === "connected" ? <div className="error-banner">{errorText}</div> : null}
    </div>
  );
}

export default App;
