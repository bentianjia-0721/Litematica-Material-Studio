export interface StackBreakdown {
  quantity: number;
  maxStackSize: number | null;
  fullStacks: number | null;
  remainder: number | null;
  text: string;
}

function normalizeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(quantity));
}

function normalizeStackSize(maxStackSize: number | null | undefined): number | null {
  if (typeof maxStackSize !== "number" || !Number.isSafeInteger(maxStackSize) || maxStackSize < 1) {
    return null;
  }
  return maxStackSize;
}

export function calculateStackBreakdown(
  quantity: number,
  maxStackSize: number | null | undefined,
): StackBreakdown {
  const normalizedQuantity = normalizeQuantity(quantity);
  const normalizedStackSize = normalizeStackSize(maxStackSize);
  if (normalizedStackSize === null) {
    return {
      quantity: normalizedQuantity,
      maxStackSize: null,
      fullStacks: null,
      remainder: null,
      text: "无法计算",
    };
  }
  if (normalizedQuantity === 0) {
    return {
      quantity: 0,
      maxStackSize: normalizedStackSize,
      fullStacks: 0,
      remainder: 0,
      text: "0 个",
    };
  }
  if (normalizedStackSize === 1) {
    return {
      quantity: normalizedQuantity,
      maxStackSize: 1,
      fullStacks: normalizedQuantity,
      remainder: 0,
      text: `${normalizedQuantity} 个`,
    };
  }
  const fullStacks = Math.floor(normalizedQuantity / normalizedStackSize);
  const remainder = normalizedQuantity % normalizedStackSize;
  const text =
    fullStacks === 0
      ? `${remainder} 个`
      : remainder === 0
        ? `${fullStacks} 组`
        : `${fullStacks} 组 + ${remainder} 个`;
  return {
    quantity: normalizedQuantity,
    maxStackSize: normalizedStackSize,
    fullStacks,
    remainder,
    text,
  };
}
