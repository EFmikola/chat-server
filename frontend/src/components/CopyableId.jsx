import IconButton from "./IconButton";
import { CheckIcon, CopyIcon } from "../ui/icons";

function CopyableId({ value, shortValue, label, copyStateKey, onCopy, compact = false }) {
  if (!value) {
    return null;
  }

  const isCopied = copyStateKey === value;

  return (
    <div className={`copy-chip${compact ? " copy-chip-compact" : ""}`} title={value}>
      <div className="copy-chip-copy">
        <span className="copy-chip-label">{label}</span>
        <span className="copy-chip-value">{shortValue ?? value}</span>
      </div>
      <IconButton
        icon={isCopied ? CheckIcon : CopyIcon}
        mode="icon-only"
        variant="subtle"
        title={isCopied ? "Скопировано" : `Скопировать ${label.toLowerCase()}`}
        ariaLabel={isCopied ? `${label} скопирован` : `Скопировать ${label.toLowerCase()}`}
        onClick={() => onCopy(value)}
      />
    </div>
  );
}

export default CopyableId;
