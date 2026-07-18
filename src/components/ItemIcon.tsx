import { useMemo, useState, type CSSProperties } from "react";

interface ItemIconProps {
  itemId: string;
  displayName: string;
  src?: string | undefined;
  compact?: boolean;
}

export function ItemIcon({ itemId, displayName, src, compact = false }: ItemIconProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedSrc = useMemo(
    () =>
      src?.startsWith("/") && !src.startsWith("//")
        ? `${import.meta.env.BASE_URL}${src.slice(1)}`
        : src,
    [src],
  );
  const hue = useMemo(
    () => ([...itemId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 80) + 125,
    [itemId],
  );

  return (
    <span
      className={`item-icon${compact ? " item-icon--compact" : ""}`}
      style={{ "--item-hue": String(hue) } as CSSProperties}
      aria-hidden="true"
      title={displayName}
    >
      {resolvedSrc && failedSrc !== resolvedSrc ? (
        <img
          src={resolvedSrc}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(resolvedSrc)}
        />
      ) : (
        <i />
      )}
    </span>
  );
}
