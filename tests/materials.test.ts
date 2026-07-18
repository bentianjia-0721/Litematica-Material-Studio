import { beforeAll, describe, expect, it } from "vitest";
import type { MinecraftVersionData } from "../src/lib/minecraft-data";
import { listMinecraftVersions, loadMinecraftVersionData } from "../src/lib/minecraft-data";
import { convertBlockState, convertBlockStateCounts } from "../src/lib/materials";

let data: MinecraftVersionData;
let legacyData: MinecraftVersionData;
let data118: MinecraftVersionData;
let data1194: MinecraftVersionData;

beforeAll(async () => {
  [data, legacyData, data118, data1194] = await Promise.all([
    loadMinecraftVersionData("1.21.4"),
    loadMinecraftVersionData("1.12.2"),
    loadMinecraftVersionData("1.18.2"),
    loadMinecraftVersionData("1.19.4"),
  ]);
});

describe("BlockState to material conversion", () => {
  it("covers air, fluids, redstone, wall variants and generated halves", () => {
    const rows = convertBlockStateCounts(
      [
        { key: "minecraft:air", name: "minecraft:air", properties: {}, count: 999 },
        { key: "water[level=0]", name: "minecraft:water", properties: { level: "0" }, count: 2 },
        { key: "lava[level=0]", name: "minecraft:lava", properties: { level: "0" }, count: 1 },
        {
          key: "redstone_wire[power=7]",
          name: "minecraft:redstone_wire",
          properties: { power: "7" },
          count: 5,
        },
        {
          key: "wall_torch[facing=north]",
          name: "minecraft:wall_torch",
          properties: { facing: "north" },
          count: 4,
        },
        {
          key: "oak_door[half=lower]",
          name: "minecraft:oak_door",
          properties: { half: "lower" },
          count: 2,
        },
        {
          key: "oak_door[half=upper]",
          name: "minecraft:oak_door",
          properties: { half: "upper" },
          count: 2,
        },
        {
          key: "red_bed[part=foot]",
          name: "minecraft:red_bed",
          properties: { part: "foot" },
          count: 3,
        },
        {
          key: "red_bed[part=head]",
          name: "minecraft:red_bed",
          properties: { part: "head" },
          count: 3,
        },
        {
          key: "sunflower[half=lower]",
          name: "minecraft:sunflower",
          properties: { half: "lower" },
          count: 1,
        },
        {
          key: "sunflower[half=upper]",
          name: "minecraft:sunflower",
          properties: { half: "upper" },
          count: 1,
        },
      ],
      data,
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId["minecraft:air"]).toBeUndefined();
    expect(byId["minecraft:water_bucket"]?.required).toBe(2);
    expect(byId["minecraft:water_bucket"]?.status).toBe("verified");
    expect(byId["minecraft:lava_bucket"]?.required).toBe(1);
    expect(byId["minecraft:redstone"]?.required).toBe(5);
    expect(byId["minecraft:torch"]?.required).toBe(4);
    expect(byId["minecraft:oak_door"]?.required).toBe(2);
    expect(byId["minecraft:red_bed"]?.required).toBe(3);
    expect(byId["minecraft:sunflower"]?.required).toBe(1);
  });

  it("matches Litematica Pick Block rules for technical blocks and source fluids", () => {
    const rows = convertBlockStateCounts(
      {
        "minecraft:end_portal": 4,
        "minecraft:nether_portal[axis=x]": 5,
        "minecraft:end_gateway": 1,
        "minecraft:piston_head[facing=north]": 3,
        "minecraft:moving_piston[facing=south]": 2,
        "minecraft:bubble_column[drag=true]": 8,
        "minecraft:fire[age=0]": 2,
        "minecraft:soul_fire": 2,
        "minecraft:frosted_ice[age=1]": 2,
        "minecraft:water[level=0]": 2,
        "minecraft:water[level=5]": 9,
        "minecraft:flowing_water[level=0]": 7,
        "minecraft:lava[level=0]": 1,
        "minecraft:lava[level=3]": 6,
        "minecraft:stone": 1,
      },
      data,
    );
    const required = Object.fromEntries(rows.map((row) => [row.id, row.required]));
    expect(required).toEqual({
      "minecraft:water_bucket": 2,
      "minecraft:lava_bucket": 1,
      "minecraft:stone": 1,
    });
  });

  it("handles farmland, Pick Block aliases, multi-face growth and potted blocks", () => {
    const rows = convertBlockStateCounts(
      {
        "minecraft:farmland[moisture=7]": 3,
        "minecraft:sweet_berry_bush[age=3]": 2,
        "minecraft:powder_snow": 1,
        "minecraft:pumpkin_stem[age=7]": 4,
        "minecraft:glow_lichen[up=true,north=true,south=false,east=false,west=false,down=false]": 3,
        "minecraft:potted_dandelion": 2,
      },
      data,
    );
    const required = Object.fromEntries(rows.map((row) => [row.id, row.required]));
    expect(required["minecraft:dirt"]).toBe(3);
    expect(required["minecraft:sweet_berries"]).toBe(2);
    expect(required["minecraft:powder_snow_bucket"]).toBe(1);
    expect(required["minecraft:pumpkin_seeds"]).toBe(4);
    expect(required["minecraft:glow_lichen"]).toBe(6);
    expect(required["minecraft:flower_pot"]).toBe(2);
    expect(required["minecraft:dandelion"]).toBe(2);
  });

  it("keeps legacy 1.12.2 Pick Block conversions instead of dropping real materials", () => {
    const rows = convertBlockStateCounts(
      {
        "minecraft:grass_path": 2,
        "minecraft:carrots[age=7]": 3,
        "minecraft:potatoes[age=7]": 4,
        "minecraft:beetroots[age=3]": 5,
        "minecraft:daylight_detector_inverted[power=15]": 1,
        "minecraft:flower_pot[contents=oak_sapling]": 2,
        "minecraft:flower_pot[contents=rose]": 3,
        "minecraft:flower_pot[contents=mushroom_brown]": 4,
        "minecraft:end_portal": 8,
      },
      legacyData,
    );
    const required = Object.fromEntries(rows.map((row) => [row.id, row.required]));
    expect(required["minecraft:grass"]).toBe(2);
    expect(required["minecraft:carrot"]).toBe(3);
    expect(required["minecraft:potato"]).toBe(4);
    expect(required["minecraft:beetroot_seeds"]).toBe(5);
    expect(required["minecraft:daylight_detector"]).toBe(1);
    expect(required["minecraft:flower_pot"]).toBe(9);
    expect(required["minecraft:sapling"]).toBe(2);
    expect(required["minecraft:red_flower"]).toBe(3);
    expect(required["minecraft:brown_mushroom"]).toBe(4);
    expect(required["minecraft:end_portal"]).toBeUndefined();
  });

  it("fills known 1.18.2 registry gaps with the same Pick Block results", () => {
    const rows = convertBlockStateCounts(
      {
        "minecraft:water_cauldron[level=3]": 1,
        "minecraft:lava_cauldron[level=3]": 1,
        "minecraft:powder_snow_cauldron[level=3]": 1,
        "minecraft:cocoa[age=2]": 2,
        "minecraft:kelp_plant": 3,
        "minecraft:bamboo_sapling": 4,
        "minecraft:big_dripleaf_stem": 5,
        "minecraft:white_candle_cake[lit=false]": 2,
        "minecraft:potted_azalea_bush": 1,
        "minecraft:carrots[age=7]": 6,
      },
      data118,
    );
    const required = Object.fromEntries(rows.map((row) => [row.id, row.required]));
    expect(required["minecraft:cauldron"]).toBe(3);
    expect(required["minecraft:cocoa_beans"]).toBe(2);
    expect(required["minecraft:kelp"]).toBe(3);
    expect(required["minecraft:bamboo"]).toBe(4);
    expect(required["minecraft:big_dripleaf"]).toBe(5);
    expect(required["minecraft:white_candle"]).toBe(2);
    expect(required["minecraft:flower_pot"]).toBe(1);
    expect(required["minecraft:azalea"]).toBe(1);
    expect(required["minecraft:carrot"]).toBe(6);
  });

  it("does not lose 1.19.4 crops or potted plants when registry mappings are absent", () => {
    const rows = convertBlockStateCounts(
      { "minecraft:torchflower_crop[age=1]": 7, "minecraft:potted_cherry_sapling": 2 },
      data1194,
    );
    const required = Object.fromEntries(rows.map((row) => [row.id, row.required]));
    expect(required["minecraft:torchflower_seeds"]).toBe(7);
    expect(required["minecraft:flower_pot"]).toBe(2);
    expect(required["minecraft:cherry_sapling"]).toBe(2);
  });

  it("classifies every missing vanilla registry mapping across supported versions", async () => {
    const emptyPickStackIds = new Set([
      "minecraft:air",
      "minecraft:cave_air",
      "minecraft:void_air",
      "minecraft:piston_head",
      "minecraft:moving_piston",
      "minecraft:piston_extension",
      "minecraft:fire",
      "minecraft:soul_fire",
      "minecraft:nether_portal",
      "minecraft:portal",
      "minecraft:end_portal",
      "minecraft:end_gateway",
      "minecraft:frosted_ice",
      "minecraft:bubble_column",
    ]);

    for (const summary of listMinecraftVersions()) {
      const versionData = await loadMinecraftVersionData(summary.version);
      for (const [blockId, block] of Object.entries(versionData.blocks)) {
        const mapped = versionData.blockToItem[blockId] ?? block.itemId;
        if (mapped && mapped !== "minecraft:air") continue;
        const conversion = convertBlockState(
          { key: blockId, name: blockId, properties: {}, count: 1 },
          versionData,
        );
        expect(
          conversion.status === "ignored",
          `${summary.version} ${blockId} 的 Pick Block 分类错误`,
        ).toBe(emptyPickStackIds.has(blockId));
      }
    }
  });

  it("multiplies snow layers, candles, sea pickles and double slabs", () => {
    const rows = convertBlockStateCounts(
      {
        "minecraft:snow[layers=3]": 2,
        "minecraft:candle[candles=4]": 2,
        "minecraft:sea_pickle[pickles=3]": 3,
        "minecraft:stone_slab[type=double]": 4,
      },
      data,
    );
    const required = Object.fromEntries(rows.map((row) => [row.id, row.required]));
    expect(required["minecraft:snow"]).toBe(6);
    expect(required["minecraft:candle"]).toBe(8);
    expect(required["minecraft:sea_pickle"]).toBe(9);
    expect(required["minecraft:stone_slab"]).toBe(8);
  });

  it("merges states mapping to one item and keeps unknown Mod IDs", () => {
    const rows = convertBlockStateCounts(
      new Map([
        ["minecraft:oak_stairs[facing=north,half=bottom]", 4],
        ["minecraft:oak_stairs[facing=south,half=top]", 6],
        ["examplemod:impossible_marble[variant=blue]", 7],
      ]),
      data,
    );
    expect(rows.find((row) => row.id === "minecraft:oak_stairs")?.required).toBe(10);
    const modded = rows.find((row) => row.id === "examplemod:impossible_marble");
    expect(modded?.required).toBe(7);
    expect(modded?.status).toBe("unknown");
    expect(modded?.maxStackSize).toBeNull();
    expect(modded?.warnings.join(" ")).toContain("Mod 方块 ID");
  });

  it("supports a valid per-project stack override without mutating version data", () => {
    const rows = convertBlockStateCounts(
      { "minecraft:end_portal": 1, "minecraft:stone": 2, "examplemod:machine": 3 },
      data,
      { maxStackOverrides: { "examplemod:machine": 16, "minecraft:stone": 1 } },
    );
    expect(rows.find((row) => row.id === "minecraft:end_portal")).toBeUndefined();
    expect(rows.find((row) => row.id === "examplemod:machine")?.maxStackSize).toBe(16);
    expect(rows.find((row) => row.id === "minecraft:stone")?.maxStackSize).toBe(1);
    expect(data.items["minecraft:stone"]?.maxStackSize).toBe(64);
  });
});
