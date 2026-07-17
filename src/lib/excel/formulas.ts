export function remainingFormula(rowNumber: number): string {
  return `MAX(0,D${rowNumber}-F${rowNumber})`;
}

export function completionFormula(rowNumber: number): string {
  return `IF(D${rowNumber}=0,1,MIN(1,F${rowNumber}/D${rowNumber}))`;
}

export function stackBreakdownFormula(quantityColumn: "D" | "F" | "H", rowNumber: number): string {
  const quantity = `${quantityColumn}${rowNumber}`;
  const stackSize = `L${rowNumber}`;

  return [
    `IF(OR(${quantity}="",${quantity}=0),`,
    '"0 个",',
    `IF(OR(${stackSize}="",${stackSize}<=0),`,
    '"无法计算",',
    `IF(${stackSize}=1,`,
    `${quantity}&" 个",`,
    `IF(QUOTIENT(${quantity},${stackSize})=0,`,
    `MOD(${quantity},${stackSize})&" 个",`,
    `IF(MOD(${quantity},${stackSize})=0,`,
    `QUOTIENT(${quantity},${stackSize})&" 组",`,
    `QUOTIENT(${quantity},${stackSize})&" 组 + "&MOD(${quantity},${stackSize})&" 个"`,
    ")))))",
  ].join("");
}

export function calculateStackBreakdown(quantity: number, maxStackSize: number | null): string {
  if (quantity === 0) {
    return "0 个";
  }

  if (maxStackSize === null || maxStackSize <= 0) {
    return "无法计算";
  }

  if (maxStackSize === 1) {
    return `${quantity} 个`;
  }

  const fullStacks = Math.floor(quantity / maxStackSize);
  const remainder = quantity % maxStackSize;

  if (fullStacks === 0) {
    return `${remainder} 个`;
  }

  if (remainder === 0) {
    return `${fullStacks} 组`;
  }

  return `${fullStacks} 组 + ${remainder} 个`;
}
