import {
  getBlockData,
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
  "minecraft:pitcher_crop",
  "minecraft:tall_seagrass",
  "minecraft:double_plant",
]);

/** Blocks whose vanilla Pick Block result is empty, matching Litematica's material cache. */
const EMPTY_PICK_STACK_IDS = new Set([
  "minecraft:piston_head",
  "minecraft:moving_piston",
  "minecraft:piston_extension",
  "minecraft:nether_portal",
  "minecraft:portal",
  "minecraft:end_portal",
  "minecraft:end_gateway",
  "minecraft:bubble_column",
  "minecraft:fire",
  "minecraft:soul_fire",
  "minecraft:frosted_ice",
]);

const MULTIFACE_GROWTH_BLOCKS = new Set([
  "minecraft:glow_lichen",
  "minecraft:sculk_vein",
  "minecraft:resin_clump",
]);

const explicitAliases: Record<string, string> = {
  "minecraft:redstone_wire": "minecraft:redstone",
  "minecraft:tripwire": "minecraft:string",
  "minecraft:farmland": "minecraft:dirt",
  "minecraft:tall_seagrass": "minecraft:seagrass",
  "minecraft:sweet_berry_bush": "minecraft:sweet_berries",
  "minecraft:weeping_vines_plant": "minecraft:weeping_vines",
  "minecraft:twisting_vines_plant": "minecraft:twisting_vines",
  "minecraft:powder_snow": "minecraft:powder_snow_bucket",
  "minecraft:cave_vines": "minecraft:glow_berries",
  "minecraft:cave_vines_plant": "minecraft:glow_berries",
  "minecraft:pumpkin_stem": "minecraft:pumpkin_seeds",
  "minecraft:attached_pumpkin_stem": "minecraft:pumpkin_seeds",
  "minecraft:melon_stem": "minecraft:melon_seeds",
  "minecraft:attached_melon_stem": "minecraft:melon_seeds",
  "minecraft:carrots": "minecraft:carrot",
  "minecraft:potatoes": "minecraft:potato",
  "minecraft:beetroots": "minecraft:beetroot_seeds",
  "minecraft:daylight_detector_inverted": "minecraft:daylight_detector",
  "minecraft:water_cauldron": "minecraft:cauldron",
  "minecraft:lava_cauldron": "minecraft:cauldron",
  "minecraft:powder_snow_cauldron": "minecraft:cauldron",
  "minecraft:kelp_plant": "minecraft:kelp",
  "minecraft:bamboo_sapling": "minecraft:bamboo",
  "minecraft:big_dripleaf_stem": "minecraft:big_dripleaf",
  "minecraft:torchflower_crop": "minecraft:torchflower_seeds",
  "minecraft:snow_layer": "minecraft:snow",
  "minecraft:standing_sign": "minecraft:sign",
  "minecraft:wall_sign": "minecraft:sign",
  "minecraft:standing_banner": "minecraft:banner",
  "minecraft:wall_banner": "minecraft:banner",
  "minecraft:double_stone_slab": "minecraft:stone_slab",
  "minecraft:double_wooden_slab": "minecraft:wooden_slab",
};

const LEGACY_POTTED_ITEM_ALIASES: Record<string, string> = {
  dandelion: "minecraft:yellow_flower",
  poppy: "minecraft:red_flower",
  blue_orchid: "minecraft:red_flower",
  allium: "minecraft:red_flower",
  azure_bluet: "minecraft:red_flower",
  red_tulip: "minecraft:red_flower",
  orange_tulip: "minecraft:red_flower",
  white_tulip: "minecraft:red_flower",
  pink_tulip: "minecraft:red_flower",
  oxeye_daisy: "minecraft:red_flower",
  rose: "minecraft:red_flower",
  houstonia: "minecraft:red_flower",
  fern: "minecraft:tallgrass",
  dead_bush: "minecraft:deadbush",
  mushroom_red: "minecraft:red_mushroom",
  mushroom_brown: "minecraft:brown_mushroom",
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

function inferKnownAlias(blockId: string, versionData: MinecraftVersionData): string | null {
  if (blockId.endsWith("_door")) return blockId;
  if (blockId.endsWith("_bed")) return blockId;
  if (blockId === "minecraft:grass_path" && versionData.minecraftVersion.startsWith("1.12")) {
    return "minecraft:grass";
  }
  if (blockId === "minecraft:cocoa" && getItemData(versionData, "minecraft:cocoa_beans")) {
    return "minecraft:cocoa_beans";
  }
  if (blockId === "minecraft:candle_cake") return "minecraft:candle";
  if (blockId.endsWith("_candle_cake")) return blockId.slice(0, -"_cake".length);
  return explicitAliases[blockId] ?? wallVariantItem(blockId);
}

function fluidItem(blockId: string, properties: Readonly<Record<string, string>>): string | null {
  if (blockId === "minecraft:flowing_water" || blockId === "minecraft:flowing_lava") return null;
  const level = Number.parseInt(properties.level ?? "0", 10);
  if (Number.isInteger(level) && level !== 0) return null;
  return blockId === "minecraft:water" ? "minecraft:water_bucket" : "minecraft:lava_bucket";
}

function countEnabledFaces(properties: Readonly<Record<string, string>>): number {
  return ["up", "down", "north", "south", "east", "west"].filter(
    (direction) => properties[direction] === "true",
  ).length;
}

function resolvePottedPlantItem(
  blockId: string,
  properties: Readonly<Record<string, string>>,
  versionData: MinecraftVersionData,
): string | null {
  const suffix = blockId.startsWith("minecraft:potted_")
    ? blockId.slice("minecraft:potted_".length)
    : blockId === "minecraft:flower_pot" && properties.contents !== "empty"
      ? properties.contents
      : undefined;
  if (!suffix) return null;
  const modernSuffix =
    suffix === "azalea_bush"
      ? "azalea"
      : suffix === "flowering_azalea_bush"
        ? "flowering_azalea"
        : suffix;
  const candidates = [
    `minecraft:${modernSuffix}`,
    ...(suffix.endsWith("_sapling") ? ["minecraft:sapling"] : []),
    ...(LEGACY_POTTED_ITEM_ALIASES[suffix] ? [LEGACY_POTTED_ITEM_ALIASES[suffix]] : []),
  ];
  return candidates.find((candidate) => getItemData(versionData, candidate)) ?? null;
}

export function convertBlockState(
  state: NormalizedBlockStateCount,
  versionData: MinecraftVersionData,
): BlockMaterialConversion {
  const blockId = normalizeMinecraftId(state.name);
  if (AIR_IDS.has(blockId)) return ignored(blockId, "空气不属于需准备材料");
  if (EMPTY_PICK_STACK_IDS.has(blockId)) {
    return ignored(blockId, "该技术方块的取方块物品为空，不属于需准备材料");
  }

  if ((blockId.endsWith("_door") || DOUBLE_HEIGHT_BLOCKS.has(blockId)) && isUpperHalf(state)) {
    return ignored(blockId, "上半部分由一个物品放置自动生成");
  }
  if (blockId.endsWith("_bed") && isSecondaryBedPart(state)) {
    return ignored(blockId, "床头部分由床物品放置自动生成");
  }

  let multiplier = 1;
  const warnings: string[] = [];
  const status: BlockMaterialConversion["status"] = "verified";
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
  } else if (MULTIFACE_GROWTH_BLOCKS.has(blockId)) {
    multiplier = Math.max(1, countEnabledFaces(state.properties));
  } else if (
    state.properties.type === "double" ||
    (blockId.includes("double_") && blockId.endsWith("_slab"))
  ) {
    multiplier = 2;
  }

  const isFluid =
    blockId === "minecraft:water" ||
    blockId === "minecraft:flowing_water" ||
    blockId === "minecraft:lava" ||
    blockId === "minecraft:flowing_lava";
  if (isFluid) {
    const itemId = fluidItem(blockId, state.properties);
    if (!itemId) return ignored(blockId, "Litematica 仅把源流体计入材料，流动流体不会生成物品");
    return { blockId, itemId, itemMultiplier: 1, status, warnings };
  }

  if (blockId.startsWith("minecraft:potted_") || blockId === "minecraft:flower_pot") {
    const plantItemId = resolvePottedPlantItem(blockId, state.properties, versionData);
    if (plantItemId) {
      return {
        blockId,
        itemId: "minecraft:flower_pot",
        itemMultiplier: 1,
        additionalItems: [{ itemId: plantItemId, itemMultiplier: 1 }],
        status,
        warnings,
      };
    }
  }

  const alias = inferKnownAlias(blockId, versionData);
  const mapped = alias ?? resolveBlockItemId(versionData, blockId);
  if (mapped) {
    const itemId = normalizeMinecraftId(mapped);
    if (itemId === "minecraft:air") {
      return ignored(blockId, "该方块的取方块物品为空，不属于需准备材料");
    }
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
  if (namespace === "minecraft" && getBlockData(versionData, blockId)) {
    return ignored(blockId, "该版本中此原版方块没有可准备的取方块物品");
  }
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
