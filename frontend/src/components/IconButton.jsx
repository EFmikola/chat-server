function IconButton({
  icon: Icon,
  label,
  title,
  ariaLabel,
  onClick,
  disabled = false,
  variant = "primary",
  mode = "icon-text",
  type = "button",
  className = "",
}) {
  const classes = [
    "icon-button",
    `icon-button-${variant}`,
    mode === "icon-only" ? "icon-button-icon-only" : "icon-button-icon-text",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? label}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {mode === "icon-text" && label ? <span>{label}</span> : null}
    </button>
  );
}

export default IconButton;