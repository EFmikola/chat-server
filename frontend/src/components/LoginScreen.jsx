import IconButton from "./IconButton";
import { ChatBubbleIcon } from "../ui/icons";

function LoginScreen({
  usernameInput,
  status,
  statusLabel,
  errorText,
  hasRecoverableSession,
  onUsernameChange,
  onSubmit,
}) {
  const buttonLabel =
    status === "connecting"
      ? "Подключаем..."
      : hasRecoverableSession
        ? "Подключиться снова"
        : "Войти в чат";

  return (
    <div className="login-shell">
      <section className="login-card">
        <div className="login-content">
          <div className="login-mark" aria-hidden="true">
            <ChatBubbleIcon />
          </div>

          <div className="login-copy">
            <h1 className="login-title">Чат</h1>
            <p className="login-subtitle">
              Подключитесь под своим именем и продолжайте общение без лишних действий на рабочем экране.
            </p>
          </div>

          {hasRecoverableSession ? (
            <div className="login-hint">
              <div className="login-hint-icon" aria-hidden="true">
                <ChatBubbleIcon />
              </div>
              <div>
                <strong>Сессия была прервана</strong>
                <span>Имя сохранено. Можно быстро подключиться снова.</span>
              </div>
            </div>
          ) : null}

          <div className="status-pill">
            <span className={`status-dot status-${status}`} />
            <span>{statusLabel}</span>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label className="field-label" htmlFor="username-input">
              Имя
            </label>
            <input
              id="username-input"
              className="input"
              value={usernameInput}
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="Введите имя"
              autoComplete="off"
              autoFocus
            />
            <IconButton
              icon={ChatBubbleIcon}
              label={buttonLabel}
              type="submit"
              variant="primary"
              mode="icon-text"
              disabled={status === "connecting"}
              title={buttonLabel}
              ariaLabel={buttonLabel}
            />
          </form>

          {errorText ? <div className="section-note">{errorText}</div> : null}
        </div>
      </section>
    </div>
  );
}

export default LoginScreen;