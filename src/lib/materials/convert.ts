import { getItemData, normalizeMinecraftId, resolveMaxStackSize } from "../minecraft-data";
import { convertBlockState } from "./block-to-item";
import { normalizeBlockStateCounts } from "./normalize";
import type {
  BlockStateCountsInput,
  MaterialConversionOptions,
  MaterialRow,
  MaterialStatus,
} from "./types";
import type { MinecraftVersionData } from "../minecraft-data";

interface MutableMaterialRow extends MaterialRow {
  sourceBlockIds: string[];
}

const statusRank: Record<Exclude<MaterialStatus, "ignored">, number> = {
  verified: 0,
  inferred: 1,
  unknown: 2,
};

function worseStatus(
  left: Exclude<MaterialStatus, "ignored">,
  right: Exclude<MaterialStatus, "ignored">,
): Exclude<MaterialStatus, "ignored"> {
  return statusRank[left] >= statusRank[right] ? left : right;
}

function safeMultiply(left: number, right: number, ceiling: number): [number, boolean] {
  if (left <= 0 || right <= 0) return [0, false];
  if (left > ceiling / right) return [ceiling, true];
  return [Math.min(ceiling, Math.floor(left * right)), false];
}

export function convertBlockStateCounts(
  counts: BlockStateCountsInput,
  versionData: MinecraftVersionData,
  options: MaterialConversionOptions = {},
): MaterialRow[] {
  const rows = new Map<string, MutableMaterialRow>();
  const ceiling = Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, Math.floor(options.maxQuantity ?? Number.MAX_SAFE_INTEGER)),
  );

  for (const state of normalizeBlockStateCounts(counts)) {
    const conversion = convertBlockState(state, versionData);
    if (conversion.status === "ignored" || !conversion.itemId || !conversion.itemMultiplier) {
      continue;
    }
    const itemId = normalizeMinecraftId(conversion.itemId);
    const [quantity, overflowed] = safeMultiply(state.count, conversion.itemMultiplier, ceiling);
    if (quantity === 0) continue;
    const item = getItemData(versionData, itemId);
    const nameEn = item?.displayNameEn ?? itemId;
    const displayName = item?.displayNameZhCn ?? nameEn ?? itemId;
    const warnings = [...conversion.warnings];
    if (overflowed) warnings.push(`数量超过安全上限，已限制为 ${ceiling}`);
    const override = options.maxStackOverrides?.[itemId];
    if (
      override !== undefined &&
      override !== null &&
      (!Number.isSafeInteger(override) || override < 1)
    ) {
      warnings.push(`忽略无效的手动堆叠上限 ${String(override)}`);
    }

    const existing = rows.get(itemId);
    if (existing) {
      const [required, sumOverflowed] = safeMultiply(1, existing.required + quantity, ceiling);
      existing.required = required;
      existing.status = worseStatus(existing.status, conversion.status);
      existing.warnings = [
        ...new Set([
          ...existing.warnings,
          ...warnings,
          ...(sumOverflowed ? [`合计数量超过安全上限，已限制为 ${ceiling}`] : []),
        ]),
      ];
      const firstWarning = existing.warnings[0];
      if (firstWarning) existing.warning = firstWarning;
      else delete existing.warning;
      if (!existing.sourceBlockIds.includes(conversion.blockId)) {
        existing.sourceBlockIds.push(conversion.blockId);
      }
      continue;
    }

    const status = conversion.status;
    const maxStackSize = resolveMaxStackSize(versionData, itemId, override);
    rows.set(itemId, {
      id: itemId,
      name: displayName,
      ...(item?.displayNameZhCn ? { nameZhCn: item.displayNameZhCn } : {}),
      nameEn,
      displayName,
      displayNameEn: nameEn,
      ...(item?.iconPath ? { iconPath: item.iconPath } : {}),
      maxStackSize,
      status,
      required: quantity,
      warnings,
      ...(warnings[0] ? { warning: warnings[0] } : {}),
      sourceBlockIds: [conversion.blockId],
    });
  }

  return [...rows.values()].sort(
    (left, right) => right.required - left.required || left.id.localeCompare(right.id),
  );
}
