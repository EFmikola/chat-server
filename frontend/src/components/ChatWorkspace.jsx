import CopyableId from "./CopyableId";
import IconButton from "./IconButton";
import {
  ChatBubbleIcon,
  CreateRoomIcon,
  DirectMessageIcon,
  JoinRoomIcon,
  LeaveRoomIcon,
  LogoutIcon,
  PlusIcon,
  SearchIcon,
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
  searchQuery,
  onSearchQueryChange,
  searchStatus,
  searchResults,
  searchOpenCreateGroup,
  onToggleCreateGroup,
  roomTitle,
  onRoomTitleChange,
  onCreateRoom,
  onCancelCreateGroup,
  createGroupSubmitting,
  chats,
  selectedChat,
  selectedChatId,
  onSelectChat,
  onSelectSearchResult,
  pendingPreview,
  pendingPreviewConnecting,
  onConnectPendingPreview,
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
  const isSearchMode = searchQuery.trim().length > 0;
  const displayTitle = pendingPreview ? pendingPreview.title : selectedChat ? selectedChat.title : "Выберите чат";
  const displayId = pendingPreview?.chatId ?? selectedChat?.id ?? "";
  const previewBadge = pendingPreview
    ? pendingPreview.chatType === "dm"
      ? "Личный чат"
      : pendingPreview.subtitle
    : null;
  const connectButtonLabel = pendingPreviewConnecting ? "Подключаем..." : "Подключиться";
  const connectIcon = pendingPreview?.chatType === "room" ? JoinRoomIcon : DirectMessageIcon;
  const listTitle = isSearchMode ? "Результаты поиска" : "Чаты";
  const listNote = isSearchMode
    ? searchStatus === "loading"
      ? "Ищем..."
      : `${searchResults.length} найдено`
    : `${chats.length} всего`;

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
          <div className="sidebar-top">
            <div className="search-toolbar">
              <label className="search-field" htmlFor="catalog-search-input">
                <SearchIcon className="search-input-icon" aria-hidden="true" />
                <input
                  id="catalog-search-input"
                  className="search-input"
                  value={searchQuery}
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                  placeholder="Поиск людей и групп"
                  autoComplete="off"
                />
              </label>
              <IconButton
                icon={PlusIcon}
                mode="icon-only"
                variant={searchOpenCreateGroup ? "primary" : "secondary"}
                title={searchOpenCreateGroup ? "Скрыть создание группы" : "Создать группу"}
                ariaLabel={searchOpenCreateGroup ? "Скрыть создание группы" : "Создать группу"}
                onClick={onToggleCreateGroup}
              />
            </div>

            {searchOpenCreateGroup ? (
              <form className="create-inline-panel" onSubmit={onCreateRoom}>
                <div className="create-inline-copy">
                  <p className="action-title">Новая группа</p>
                  <p className="action-subtitle">Введите название и создайте группу из этой же колонки.</p>
                </div>
                <input
                  className="input"
                  value={roomTitle}
                  onChange={(event) => onRoomTitleChange(event.target.value)}
                  placeholder="Название группы"
                  autoComplete="off"
                />
                <div className="create-inline-actions">
                  <IconButton
                    icon={CreateRoomIcon}
                    label={createGroupSubmitting ? "Создаём..." : "Создать"}
                    type="submit"
                    variant="primary"
                    mode="icon-text"
                    disabled={createGroupSubmitting}
                    title="Создать группу"
                    ariaLabel="Создать группу"
                  />
                  <IconButton
                    icon={PlusIcon}
                    label="Отмена"
                    type="button"
                    variant="secondary"
                    mode="icon-text"
                    disabled={createGroupSubmitting}
                    title="Отменить создание группы"
                    ariaLabel="Отменить создание группы"
                    onClick={onCancelCreateGroup}
                  />
                </div>
              </form>
            ) : null}
          </div>

          <section className="chat-list-wrap">
            <div className="section-head">
              <div>
                <p className="section-label">Навигация</p>
                <h2 className="section-title">{listTitle}</h2>
              </div>
              <span className="section-note">{listNote}</span>
            </div>

            <div className="chat-list">
              {isSearchMode ? (
                <>
                  {searchStatus === "loading" ? (
                    <EmptyState title="Ищем..." text="Подбираем пользователей и группы по вашему запросу." />
                  ) : null}
                  {searchStatus === "ready" && searchResults.length === 0 ? (
                    <EmptyState title="Ничего не найдено" text="Попробуйте сократить запрос или ввести другое имя." />
                  ) : null}
                  {searchResults.map((result) => {
                    const isActive =
                      pendingPreview?.resultId === result.result_id ||
                      (!pendingPreview && result.action === "open" && result.chat_id === selectedChatId);
                    const stateLabel = result.action === "open" ? "Открыт" : "Подключиться";
                    return (
                      <button
                        type="button"
                        key={result.result_id}
                        className={`search-card${isActive ? " active" : ""}`}
                        onClick={() => onSelectSearchResult(result)}
                        title={result.title}
                      >
                        <div className="search-card-top">
                          <div className="search-card-copy">
                            <span className="chat-title">{result.title}</span>
                            <span className="search-card-subtitle">{result.subtitle}</span>
                          </div>
                          <span className={`search-state search-state-${result.action === "open" ? "open" : "connect"}`}>
                            {stateLabel}
                          </span>
                        </div>
                        <div className="search-card-bottom">
                          <span className="chat-kind">{result.chat_type === "dm" ? "ЛС" : "Группа"}</span>
                          {result.action === "open" && result.last_message_at ? (
                            <span className="chat-time">{formatTimestamp(result.last_message_at)}</span>
                          ) : null}
                        </div>
                        {result.action === "open" && result.last_message_preview ? (
                          <div className="search-preview">{result.last_message_preview}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
                  {chats.length === 0 ? (
                    <EmptyState title="Пока нет чатов" text="Используйте поиск или создайте новую группу через кнопку справа." />
                  ) : null}
                  {chats.map((chat) => {
                    const isActive = chat.id === selectedChatId && !pendingPreview;
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
                          <span className="chat-kind">{chat.type === "dm" ? "ЛС" : "Группа"}</span>
                        </div>
                        <div className="chat-card-id" title={chat.id}>
                          ID: {chat.id}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </section>
        </aside>

        <section className="workspace-content">
          <div className="chat-head">
            <div className="chat-head-main">
              <span className="chat-head-kicker">Текущий чат</span>
              <h2 className="chat-head-title">{displayTitle}</h2>
              {displayId ? (
                <CopyableId
                  value={displayId}
                  shortValue={displayId.slice(0, 8)}
                  label="ID чата"
                  copyStateKey={copyFeedbackKey}
                  onCopy={onCopy}
                  compact
                />
              ) : null}
            </div>

            <div className="chat-head-meta">
              {pendingPreview ? <span className="meta-badge">{previewBadge}</span> : null}
              {!pendingPreview && selectedChat ? (
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
            {pendingPreview ? (
              <EmptyState
                title="Сообщения будут доступны после подключения"
                text="Сначала подключитесь к найденному чату. После этого появится история и можно будет писать сообщения."
              />
            ) : !selectedChat ? (
              <EmptyState title="Выберите чат" text="Слева доступны ваши чаты и результаты поиска. После выбора можно читать историю и отправлять сообщения." />
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

          {pendingPreview ? (
            <div className="connect-bar">
              <div className="connect-bar-copy">
                <p className="connect-bar-title">Подключитесь к чату</p>
                <p className="connect-bar-text">После подключения откроется история и появится поле отправки сообщений.</p>
              </div>
              <IconButton
                icon={connectIcon}
                label={connectButtonLabel}
                type="button"
                variant="primary"
                mode="icon-text"
                disabled={pendingPreviewConnecting}
                title="Подключиться к чату"
                ariaLabel="Подключиться к чату"
                onClick={onConnectPendingPreview}
              />
            </div>
          ) : (
            <form className="composer" onSubmit={onSendMessage}>
              <div className="composer-input-wrap">
                <input
                  className="input"
                  value={messageInput}
                  onChange={(event) => onMessageInputChange(event.target.value)}
                  placeholder={canSendMessage ? "Введите сообщение..." : "Выберите чат, чтобы писать сообщения"}
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
          )}
        </section>
      </main>
    </div>
  );
}

export default ChatWorkspace;
