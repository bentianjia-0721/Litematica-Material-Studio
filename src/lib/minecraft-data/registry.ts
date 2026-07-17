import type { MinecraftVersionData, VersionedBlockData, VersionedItemData } from "./types";

export function normalizeMinecraftId(id: string, defaultNamespace = "minecraft"): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.includes(":") ? trimmed : `${defaultNamespace}:${trimmed}`;
}

export function getItemData(
  versionData: MinecraftVersionData,
  itemId: string,
): VersionedItemData | undefined {
  return versionData.items[normalizeMinecraftId(itemId)];
}

export function getBlockData(
  versionData: MinecraftVersionData,
  blockId: string,
): VersionedBlockData | undefined {
  return versionData.blocks[normalizeMinecraftId(blockId)];
}

export function resolveLegacyBlockId(
  versionData: MinecraftVersionData,
  numericId: number,
  metadata?: number,
): string | null {
  if (metadata !== undefined) {
    const exact = versionData.legacyBlockIds[`${numericId}:${metadata}`];
    if (exact) return exact;
  }
  return versionData.legacyBlockIds[String(numericId)] ?? null;
}

export function resolveBlockItemId(
  versionData: MinecraftVersionData,
  blockId: string,
): string | null {
  const normalizedId = normalizeMinecraftId(blockId);
  return versionData.blockToItem[normalizedId] ?? versionData.blocks[normalizedId]?.itemId ?? null;
}

export function resolveMaxStackSize(
  versionData: MinecraftVersionData,
  itemId: string,
  manualOverride?: number | null,
): number | null {
  if (
    manualOverride !== null &&
    manualOverride !== undefined &&
    Number.isSafeInteger(manualOverride) &&
    manualOverride > 0
  ) {
    return manualOverride;
  }
  return getItemData(versionData, itemId)?.maxStackSize ?? null;
}
