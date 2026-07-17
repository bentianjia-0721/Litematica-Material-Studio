import { useMemo, useState, type CSSProperties } from "react";

interface ItemIconProps {
  itemId: string;
  displayName: string;
  src?: string | undefined;
  compact?: boolean;
}

export function ItemIcon({ itemId, displayName, src, compact = false }: ItemIconProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
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
      {src && failedSrc !== src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <i />
      )}
    </span>
  );
}
