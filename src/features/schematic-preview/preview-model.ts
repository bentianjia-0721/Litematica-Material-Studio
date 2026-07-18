import type { BlockState, LitematicPreviewBounds } from "../../lib/litematic";

export type PreviewLayerMode = "all" | "single" | "range";

export interface PreviewLayerSelection {
  readonly mode: PreviewLayerMode;
  readonly singleLayer: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

export interface PreviewLayerRange {
  readonly min: number;
  readonly max: number;
}

export function clampLayer(value: number, bounds: LitematicPreviewBounds): number {
  return Math.min(bounds.max.y, Math.max(bounds.min.y, Math.round(value)));
}

export function resolveLayerRange(
  selection: PreviewLayerSelection,
  bounds: LitematicPreviewBounds,
): PreviewLayerRange {
  if (selection.mode === "all") {
    return { min: bounds.min.y, max: bounds.max.y };
  }

  if (selection.mode === "single") {
    const layer = clampLayer(selection.singleLayer, bounds);
    return { min: layer, max: layer };
  }

  const start = clampLayer(selection.rangeStart, bounds);
  const end = clampLayer(selection.rangeEnd, bounds);
  return { min: Math.min(start, end), max: Math.max(start, end) };
}

export function countVisibleBlocks(positions: Int32Array, range: PreviewLayerRange): number {
  let count = 0;
  for (let offset = 1; offset < positions.length; offset += 3) {
    const y = positions[offset];
    if (y !== undefined && y >= range.min && y <= range.max) count += 1;
  }
  return count;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const fallbackVoxelColours = [
  0x69a7c7, 0xc77979, 0x9b7bc9, 0x63a37a, 0xc99b62, 0x74a2d8, 0xc9709f, 0x9aa15e, 0x65a9a4,
  0xa47b63, 0x9f8ac2, 0xb0b37d,
] as const;

/**
 * Stable, readable voxel colours. This intentionally does not claim to render
 * Minecraft's block models or textures; it keeps every namespace visible.
 */
export function blockStateColor(state: BlockState): number {
  const id = state.name.toLocaleLowerCase();

  if (/(?:water|bubble_column)$/.test(id)) return 0x3f8fe8;
  if (/(?:lava|fire|magma)/.test(id)) return 0xf07837;
  if (/portal/.test(id)) return 0x9c67e8;
  if (/(?:grass|leaves|moss|vine|azalea|sapling|kelp|seagrass|cactus|bamboo)/.test(id))
    return 0x62a85a;
  if (/(?:log|wood|planks|stem|hyphae|bamboo_block|bookshelf|barrel)/.test(id)) return 0x9b6b43;
  if (/(?:sand|sandstone|end_stone|bone_block|quartz)/.test(id)) return 0xd8c997;
  if (/(?:snow|powder_snow|ice)/.test(id)) return 0xc7e8ed;
  if (/(?:glass|beacon)/.test(id)) return 0x8fcfd2;
  if (/(?:redstone|red_nether|nether_wart)/.test(id)) return 0xb94a4a;
  if (/(?:netherrack|nether_brick|soul_sand|soul_soil)/.test(id)) return 0x6f4141;
  if (/(?:stone|cobble|deepslate|andesite|diorite|granite|ore|bedrock)/.test(id)) return 0x858b88;

  const hash = hashString(state.key || state.name);
  return fallbackVoxelColours[hash % fallbackVoxelColours.length] ?? 0x8aa99a;
}
