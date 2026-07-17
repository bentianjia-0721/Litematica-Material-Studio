import {
  getItemData,
  normalizeMinecraftId,
  resolveBlockItemId,
  type MinecraftVersionData,
} from "../minecraft-data";
import type { BlockMaterialConversion, NormalizedBlockStateCount } from "./types";

const AIR_IDS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
const DOUBLE_HEIGHT_BLOCKS = new Set([
  "minecraft:sunflower",
  "minecraft:lilac",
  "minecraft:rose_bush",
  "minecraft:peony",
  "minecraft:tall_grass",
  "minecraft:large_fern",
  "minecraft:small_dripleaf",
  "minecraft:pitcher_plant",
  "minecraft:double_plant",
]);

const explicitAliases: Record<string, string> = {
  "minecraft:redstone_wire": "minecraft:redstone",
  "minecraft:tripwire": "minecraft:string",
  "minecraft:water": "minecraft:water_bucket",
  "minecraft:flowing_water": "minecraft:water_bucket",
  "minecraft:lava": "minecraft:lava_bucket",
  "minecraft:flowing_lava": "minecraft:lava_bucket",
  "minecraft:snow_layer": "minecraft:snow",
  "minecraft:standing_sign": "minecraft:sign",
  "minecraft:wall_sign": "minecraft:sign",
  "minecraft:standing_banner": "minecraft:banner",
  "minecraft:wall_banner": "minecraft:banner",
  "minecraft:double_stone_slab": "minecraft:stone_slab",
  "minecraft:double_wooden_slab": "minecraft:wooden_slab",
};

function wallVariantItem(blockId: string): string | null {
  if (blockId === "minecraft:wall_torch") return "minecraft:torch";
  if (blockId === "minecraft:soul_wall_torch") return "minecraft:soul_torch";
  const replacements: Array<[string, string]> = [
    ["_wall_hanging_sign", "_hanging_sign"],
    ["_wall_sign", "_sign"],
    ["_wall_banner", "_banner"],
    ["_wall_head", "_head"],
    ["_wall_skull", "_skull"],
    ["_wall_fan", "_fan"],
  ];
  for (const [suffix, replacement] of replacements) {
    if (blockId.endsWith(suffix)) return blockId.slice(0, -suffix.length) + replacement;
  }
  return null;
}

function ignored(blockId: string, reason: string): BlockMaterialConversion {
  return {
    blockId,
    itemId: null,
    itemMultiplier: 0,
    status: "ignored",
    warnings: [],
    ignoredReason: reason,
  };
}

function positiveProperty(
  properties: Readonly<Record<string, string>>,
  property: string,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(properties[property] ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
}

function isUpperHalf(state: NormalizedBlockStateCount): boolean {
  return state.properties.half === "upper";
}

function isSecondaryBedPart(state: NormalizedBlockStateCount): boolean {
  return state.properties.part === "head";
}

function inferKnownAlias(blockId: string): string | null {
  if (blockId.endsWith("_door")) return blockId;
  if (blockId.endsWith("_bed")) return blockId;
  return explicitAliases[blockId] ?? wallVariantItem(blockId);
}

export function convertBlockState(
  state: NormalizedBlockStateCount,
  versionData: MinecraftVersionData,
): BlockMaterialConversion {
  const blockId = normalizeMinecraftId(state.name);
  if (AIR_IDS.has(blockId)) return ignored(blockId, "空气不属于需准备材料");

  if ((blockId.endsWith("_door") || DOUBLE_HEIGHT_BLOCKS.has(blockId)) && isUpperHalf(state)) {
    return ignored(blockId, "上半部分由一个物品放置自动生成");
  }
  if (blockId.endsWith("_bed") && isSecondaryBedPart(state)) {
    return ignored(blockId, "床头部分由床物品放置自动生成");
  }

  let multiplier = 1;
  const warnings: string[] = [];
  let status: BlockMaterialConversion["status"] = "verified";
  if (blockId === "minecraft:snow" || blockId === "minecraft:snow_layer") {
    multiplier = positiveProperty(state.properties, "layers", 1, 8);
  } else if (blockId.endsWith("_candle") || blockId === "minecraft:candle") {
    multiplier = positiveProperty(state.properties, "candles", 1, 4);
  } else if (blockId === "minecraft:sea_pickle") {
    multiplier = positiveProperty(state.properties, "pickles", 1, 4);
  } else if (blockId === "minecraft:turtle_egg") {
    multiplier = positiveProperty(state.properties, "eggs", 1, 4);
  } else if (blockId === "minecraft:pink_petals") {
    multiplier = positiveProperty(state.properties, "flower_amount", 1, 4);
  } else if (
    state.properties.type === "double" ||
    (blockId.includes("double_") && blockId.endsWith("_slab"))
  ) {
    multiplier = 2;
  }

  if (
    blockId === "minecraft:water" ||
    blockId === "minecraft:flowing_water" ||
    blockId === "minecraft:lava" ||
    blockId === "minecraft:flowing_lava"
  ) {
    status = "inferred";
    warnings.push("流体方块按每个方块一次桶装流体近似；流动、无限水源和容器复用会使实际准备量不同");
  }

  const alias = inferKnownAlias(blockId);
  const mapped = alias ?? resolveBlockItemId(versionData, blockId);
  if (mapped) {
    const itemId = normalizeMinecraftId(mapped);
    if (getItemData(versionData, itemId)) {
      return { blockId, itemId, itemMultiplier: multiplier, status, warnings };
    }
    warnings.push(`版本 ${versionData.minecraftVersion} 中缺少映射物品 ${itemId}`);
    return {
      blockId,
      itemId,
      itemMultiplier: multiplier,
      status: "unknown",
      warnings,
    };
  }

  const namespace = blockId.split(":", 1)[0] ?? "minecraft";
  warnings.push(
    namespace === "minecraft"
      ? `无法可靠确定 ${blockId} 对应的生存材料；已保留原始方块 ID`
      : `未安装 ${namespace} 命名空间的物品注册表；已保留 Mod 方块 ID`,
  );
  return {
    blockId,
    itemId: blockId,
    itemMultiplier: multiplier,
    status: "unknown",
    warnings,
  };
}
