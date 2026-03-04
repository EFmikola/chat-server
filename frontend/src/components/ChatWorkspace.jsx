import CopyableId from "./CopyableId";
import IconButton from "./IconButton";
import {
  ChatBubbleIcon,
  CreateRoomIcon,
  DirectMessageIcon,
  JoinRoomIcon,
  LeaveRoomIcon,
  LogoutIcon,
  SendIcon,
} from "../ui/icons";

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <ChatBubbleIcon />
      </div>
      <p className="empty-state-title">{title}</p>
      {text ? <p className="empty-state-text">{text}</p> : null}
    </div>
  );
}

function ChatWorkspace({
  status,
  statusLabel,
  sessionUsername,
  sessionUserId,
  copyFeedbackKey,
  onCopy,
  onLogout,
  roomTitle,
  onRoomTitleChange,
  onCreateRoom,
  dmTarget,
  onDmTargetChange,
  onOpenDm,
  joinRoomId,
  onJoinRoomIdChange,
  onJoinRoom,
  chats,
  selectedChat,
  selectedChatId,
  onSelectChat,
  formatTimestamp,
  onLeaveRoom,
  canLeaveRoom,
  messagesRef,
  onMessagesScroll,
  historyLoading,
  selectedMessages,
  messageInput,
  onMessageInputChange,
  onSendMessage,
  canSendMessage,
}) {
  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div className="header-group">
          <div className="status-pill">
            <span className={`status-dot status-${status}`} />
            <span>{statusLabel}</span>
          </div>
          <div className="header-title">
            <span className="workspace-kicker">Текущая сессия</span>
            <span className="workspace-user-name">{sessionUsername || "Гость"}</span>
          </div>
        </div>

        <div className="icon-cluster">
          <CopyableId
            value={sessionUserId}
            shortValue={sessionUserId ? sessionUserId.slice(0, 8) : ""}
            label="ID пользователя"
            copyStateKey={copyFeedbackKey}
            onCopy={onCopy}
          />
          <IconButton
            icon={LogoutIcon}
            mode="icon-only"
            variant="danger"
            title="Выйти"
            ariaLabel="Выйти из сессии"
            onClick={onLogout}
          />
        </div>
      </header>

      <main className="workspace-layout">
        <aside className="workspace-sidebar">
          <section className="toolbar-section">
            <div className="section-head">
              <div>
                <p className="section-label">Действия</p>
                <h2 className="section-title">Управление чатами</h2>
              </div>
              <span className="section-note">Комнаты и личные диалоги</span>
            </div>

            <form className="action-card" onSubmit={onCreateRoom}>
              <div className="action-copy">
                <p className="action-title">Создать комнату</p>
                <p className="action-subtitle">Новая общая комната появится в списке сразу после создания.</p>
              </div>
              <div className="stack">
                <input
                  id="room-input"
                  className="input"
                  value={roomTitle}
                  onChange={(event) => onRoomTitleChange(event.target.value)}
                  placeholder="Название комнаты"
                  autoComplete="off"
                />
                <IconButton
                  icon={CreateRoomIcon}
                  label="Создать"
                  type="submit"
                  variant="primary"
                  mode="icon-text"
                  title="Создать комнату"
                  ariaLabel="Создать комнату"
                />
              </div>
            </form>

            <form className="action-card" onSubmit={onOpenDm}>
              <div className="action-copy">
                <p className="action-title">Открыть личный чат</p>
                <p className="action-subtitle">Введите имя пользователя, чтобы начать личную переписку.</p>
              </div>
              <div className="stack">
                <input
                  id="dm-input"
                  className="input"
                  value={dmTarget}
                  onChange={(event) => onDmTargetChange(event.target.value)}
                  placeholder="Имя пользователя"
                  autoComplete="off"
                />
                <IconButton
                  icon={DirectMessageIcon}
                  label="Открыть"
                  type="submit"
                  variant="secondary"
                  mode="icon-text"
                  title="Открыть личный чат"
                  ariaLabel="Открыть личный чат"
                />
              </div>
            </form>

            <form className="action-card" onSubmit={onJoinRoom}>
              <div className="action-copy">
                <p className="action-title">Войти в комнату по ID</p>
                <p className="action-subtitle">Используйте ID комнаты, если он уже известен.</p>
              </div>
              <div className="stack">
                <input
                  id="join-room-input"
                  className="input"
                  value={joinRoomId}
                  onChange={(event) => onJoinRoomIdChange(event.target.value)}
                  placeholder="ID комнаты"
                  autoComplete="off"
                />
                <IconButton
                  icon={JoinRoomIcon}
                  label="Войти"
                  type="submit"
                  variant="secondary"
                  mode="icon-text"
                  title="Войти в комнату"
                  ariaLabel="Войти в комнату по ID"
                />
              </div>
            </form>
          </section>

          <section className="chat-list-wrap">
            <div className="section-head">
              <div>
                <p className="section-label">Навигация</p>
                <h2 className="section-title">Чаты</h2>
              </div>
              <span className="section-note">{chats.length} всего</span>
            </div>

            <div className="chat-list">
              {chats.length === 0 ? (
                <EmptyState title="Пока нет чатов" text="Создайте комнату или откройте личный диалог, чтобы начать." />
              ) : null}
              {chats.map((chat) => {
                const isActive = chat.id === selectedChatId;
                return (
                  <button
                    type="button"
                    className={`chat-card${isActive ? " active" : ""}`}
                    key={chat.id}
                    onClick={() => onSelectChat(chat.id)}
                    title={chat.title}
                  >
                    <div className="chat-card-top">
                      <span className="chat-title">{chat.title}</span>
                      <span className="chat-time">{formatTimestamp(chat.last_message_at)}</span>
                    </div>
                    <div className="chat-card-bottom">
                      <span className="chat-preview">{chat.last_message_preview || "Пока нет сообщений"}</span>
                      <span className="chat-kind">{chat.type === "dm" ? "ЛС" : "Комната"}</span>
                    </div>
                    <div className="chat-card-id" title={chat.id}>
                      ID: {chat.id}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="workspace-content">
          <div className="chat-head">
            <div className="chat-head-copy">
              <p className="section-label">Текущий чат</p>
              <h2 className="chat-head-title">{selectedChat ? selectedChat.title : "Выберите чат"}</h2>
              {selectedChat ? (
                <CopyableId
                  value={selectedChat.id}
                  shortValue={selectedChat.id.slice(0, 8)}
                  label="ID чата"
                  copyStateKey={copyFeedbackKey}
                  onCopy={onCopy}
                />
              ) : null}
            </div>

            <div className="chat-head-meta">
              {selectedChat ? (
                <span className="meta-badge">
                  Онлайн: {selectedChat.online_user_ids?.length ?? 0} / {selectedChat.member_ids?.length ?? 0}
                </span>
              ) : null}
              {canLeaveRoom ? (
                <IconButton
                  icon={LeaveRoomIcon}
                  mode="icon-only"
                  variant="danger"
                  title="Покинуть комнату"
                  ariaLabel="Покинуть комнату"
                  onClick={onLeaveRoom}
                />
              ) : null}
            </div>
          </div>

          <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>
            {!selectedChat ? (
              <EmptyState title="Выберите чат" text="Слева доступны комнаты и личные диалоги. После выбора можно читать историю и отправлять сообщения." />
            ) : (
              <>
                {historyLoading ? <div className="history-loader">Загружаем историю...</div> : null}
                {selectedMessages.length === 0 ? (
                  <EmptyState title="Сообщений пока нет" text="Начните разговор первым, чтобы заполнить историю этого чата." />
                ) : null}
                {selectedMessages.map((message) => (
                  <article
                    key={message.id ?? `${message.chat_id}:${message.created_at}:${message.sender_username}:${message.content}`}
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
              </>
            )}
          </div>

          <form className="composer" onSubmit={onSendMessage}>
            <div className="composer-input-wrap">
              <input
                className="input"
                value={messageInput}
                onChange={(event) => onMessageInputChange(event.target.value)}
                placeholder={canSendMessage ? "Введите сообщение..." : "Подключитесь и выберите чат"}
                disabled={!canSendMessage}
                autoComplete="off"
              />
            </div>
            <IconButton
              icon={SendIcon}
              label="Отправить"
              type="submit"
              variant="primary"
              mode="icon-text"
              disabled={!canSendMessage}
              title="Отправить сообщение"
              ariaLabel="Отправить сообщение"
            />
          </form>
        </section>
      </main>
    </div>
  );
}

export default ChatWorkspace;