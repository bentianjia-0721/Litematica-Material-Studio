import { useId, useState } from "react";
import { calculateStackBreakdown } from "../../lib/stack/calculate-stack-breakdown";

interface StackValueProps {
  quantity: number;
  maxStackSize: number | null;
  label: string;
}

export function StackValue({ quantity, maxStackSize, label }: StackValueProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const breakdown = calculateStackBreakdown(quantity, maxStackSize);
  return (
    <span className="stack-value">
      <button
        className="stack-value__trigger"
        type="button"
        aria-label={`${label}的堆叠计算结果`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      >
        <span aria-hidden="true">▦</span>
      </button>
      <span id={id} role="tooltip" className={`stack-tooltip${open ? " stack-tooltip--open" : ""}`}>
        {breakdown.text}
      </span>
    </span>
  );
}
