import { beforeAll, describe, expect, it } from "vitest";
import type { MinecraftVersionData } from "../src/lib/minecraft-data";
import { loadMinecraftVersionData } from "../src/lib/minecraft-data";
import { convertBlockStateCounts } from "../src/lib/materials";

let data: MinecraftVersionData;

beforeAll(async () => {
  data = await loadMinecraftVersionData("1.21.4");
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
    expect(byId["minecraft:water_bucket"]?.status).toBe("inferred");
    expect(byId["minecraft:lava_bucket"]?.required).toBe(1);
    expect(byId["minecraft:redstone"]?.required).toBe(5);
    expect(byId["minecraft:torch"]?.required).toBe(4);
    expect(byId["minecraft:oak_door"]?.required).toBe(2);
    expect(byId["minecraft:red_bed"]?.required).toBe(3);
    expect(byId["minecraft:sunflower"]?.required).toBe(1);
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
      { "minecraft:end_portal": 1, "minecraft:stone": 2 },
      data,
      { maxStackOverrides: { "minecraft:end_portal": 16, "minecraft:stone": 1 } },
    );
    expect(rows.find((row) => row.id === "minecraft:end_portal")?.maxStackSize).toBe(16);
    expect(rows.find((row) => row.id === "minecraft:stone")?.maxStackSize).toBe(1);
    expect(data.items["minecraft:stone"]?.maxStackSize).toBe(64);
  });
});
