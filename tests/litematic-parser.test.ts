import { describe, expect, it } from "vitest";

import { GzipError, parseLitematic, type BlockStateCount } from "../src/lib/litematic";
import { createLitematicFixture, type FixtureRegion } from "./fixtures/litematic-fixture";

function countFor(
  counts: readonly BlockStateCount[],
  name: string,
  properties: Readonly<Record<string, string>> = {},
): number | undefined {
  return counts.find(
    (entry) =>
      entry.name === name && JSON.stringify(entry.properties) === JSON.stringify(properties),
  )?.count;
}

function previewCoordinates(result: ReturnType<typeof parseLitematic>): number[][] {
  return Array.from({ length: result.preview.sampledBlockCount }, (_, index) =>
    Array.from(result.preview.positions.slice(index * 3, index * 3 + 3)),
  );
}

describe(".litematic parser", () => {
  it("returns structured metadata, regions, counts, and stats while retaining air", () => {
    const fixture = createLitematicFixture();
    const result = parseLitematic(fixture, { fileName: "house.litematic" });

    expect(result.metadata).toMatchObject({
      name: "Litematica fixture",
      author: "Vitest",
      description: "Real gzip-compressed NBT fixture",
      timeCreated: 1_700_000_000_000n,
      timeModified: 1_700_000_001_000n,
      formatVersion: 6,
      subVersion: 1,
      minecraftDataVersion: 3953,
      regionCount: 1,
      totalVolume: 4n,
      totalBlocks: 2n,
      originalFileName: "house.litematic",
      originalFileSize: fixture.byteLength,
    });
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({
      name: "Main",
      position: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 1, z: 2 },
      dimensions: { x: 2, y: 1, z: 2 },
      volume: 4,
    });
    expect(countFor(result.blockStateCounts, "minecraft:air")).toBe(2);
    expect(countFor(result.blockStateCounts, "minecraft:stone")).toBe(2);
    expect(result.stats).toMatchObject({
      parsedRegionCount: 1,
      paletteEntryCount: 2,
      totalVolume: 4,
      decodedBlockCount: 4,
      invalidPaletteIndexCount: 0,
    });
    expect(result.preview).toMatchObject({
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 1 } },
      totalBlockCount: 2,
      sampledBlockCount: 2,
      truncated: false,
    });
    expect(result.preview.positions).toBeInstanceOf(Int32Array);
    expect(result.preview.stateIndices).toBeInstanceOf(Uint32Array);
    expect(previewCoordinates(result)).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("decodes x fastest, then z and y, from the minimum corner for signed Size axes", () => {
    const fixture = createLitematicFixture({
      regions: [
        {
          name: "Mixed directions",
          position: { x: 10, y: 20, z: 30 },
          size: { x: -3, y: -2, z: -4 },
          palette: [
            { name: "minecraft:air" },
            { name: "minecraft:redstone_block" },
            { name: "minecraft:gold_block" },
            { name: "minecraft:emerald_block" },
            { name: "minecraft:lapis_block" },
          ],
          blockIndices: Array.from({ length: 24 }, (_, index) => {
            if (index === 0) return 1; // local 0,0,0
            if (index === 2) return 2; // local 2,0,0
            if (index === 12) return 3; // local 0,1,0
            if (index === 9) return 4; // local 0,0,3
            return 0;
          }),
        },
      ],
    });

    const result = parseLitematic(fixture);
    expect(previewCoordinates(result)).toEqual([
      [8, 19, 27],
      [10, 19, 27],
      [8, 19, 30],
      [8, 20, 27],
    ]);
    expect(result.preview.bounds).toEqual({
      min: { x: 8, y: 19, z: 27 },
      max: { x: 10, y: 20, z: 30 },
    });
  });

  it("caps preview coordinates, reports truncation, and keeps the full region bounds", () => {
    const result = parseLitematic(
      createLitematicFixture({
        regions: [
          {
            name: "Capped",
            position: { x: -5, y: 7, z: 11 },
            size: { x: 10, y: 1, z: 1 },
            palette: [{ name: "minecraft:stone" }],
            blockIndices: Array(10).fill(0),
          },
        ],
      }),
      { maxPreviewBlocks: 3 },
    );

    expect(result.preview).toMatchObject({
      bounds: { min: { x: -5, y: 7, z: 11 }, max: { x: 4, y: 7, z: 11 } },
      totalBlockCount: 10,
      sampledBlockCount: 3,
      truncated: true,
    });
    expect(result.preview.positions).toHaveLength(9);
    expect(result.preview.stateIndices).toHaveLength(3);
    expect(new Set(previewCoordinates(result).map(([x]) => x)).size).toBe(3);
  });

  it("keeps fluids, portals, and technical blocks while excluding only the three air states", () => {
    const palette = [
      { name: "minecraft:air" },
      { name: "minecraft:cave_air" },
      { name: "minecraft:void_air" },
      { name: "minecraft:water" },
      { name: "minecraft:nether_portal" },
      { name: "minecraft:piston_head" },
      { name: "minecraft:bubble_column" },
    ];
    const result = parseLitematic(
      createLitematicFixture({
        regions: [
          {
            name: "Technical",
            size: { x: 7, y: 1, z: 1 },
            palette,
            blockIndices: palette.map((_, index) => index),
          },
        ],
      }),
    );

    expect(result.preview.totalBlockCount).toBe(4);
    expect(result.preview.states.map((state) => state.name).sort()).toEqual([
      "minecraft:bubble_column",
      "minecraft:nether_portal",
      "minecraft:piston_head",
      "minecraft:water",
    ]);
    expect(previewCoordinates(result)).toEqual([
      [3, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
    ]);
  });

  it("warns and omits preview data for a region without Position", () => {
    const result = parseLitematic(
      createLitematicFixture({
        regions: [
          {
            name: "No position",
            position: null,
            size: { x: 2, y: 1, z: 1 },
            palette: [{ name: "minecraft:stone" }],
            blockIndices: [0, 0],
          },
        ],
      }),
    );

    expect(countFor(result.blockStateCounts, "minecraft:stone")).toBe(2);
    expect(result.warnings.map((entry) => entry.code)).toContain("MISSING_POSITION");
    expect(result.preview).toMatchObject({
      bounds: null,
      totalBlockCount: 0,
      sampledBlockCount: 0,
      truncated: false,
    });
  });

  it("uses absolute negative dimensions and decodes non-power-of-two palettes across longs", () => {
    const palette = Array.from({ length: 17 }, (_, index) => ({
      name: index === 0 ? "minecraft:air" : `minecraft:test_${index}`,
    }));
    const blockIndices = Array.from({ length: 90 }, (_, index) => (index * 7) % 17);
    const fixture = createLitematicFixture({
      regions: [
        {
          name: "Negative",
          position: { x: 10, y: 20, z: 30 },
          size: { x: -30, y: 1, z: 3 },
          palette,
          blockIndices,
        },
      ],
    });

    const result = parseLitematic(fixture);
    expect(result.regions[0]).toMatchObject({
      size: { x: -30, y: 1, z: 3 },
      dimensions: { x: 30, y: 1, z: 3 },
      volume: 90,
    });
    expect(result.stats.decodedBlockCount).toBe(90);
    palette.forEach((entry, paletteIndex) => {
      expect(countFor(result.blockStateCounts, entry.name)).toBe(
        blockIndices.filter((index) => index === paletteIndex).length,
      );
    });
  });

  it("aggregates all regions and preserves properties and unknown namespaces", () => {
    const regions: FixtureRegion[] = [
      {
        name: "A",
        size: { x: 3, y: 1, z: 1 },
        palette: [
          { name: "minecraft:air" },
          { name: "minecraft:oak_log", properties: { axis: "y" } },
        ],
        blockIndices: [0, 1, 1],
        entityCount: 2,
      },
      {
        name: "B",
        position: { x: -4, y: 0, z: 0 },
        size: { x: -3, y: 1, z: 1 },
        palette: [
          { name: "minecraft:oak_log", properties: { axis: "y" } },
          { name: "examplemod:glowing_block", properties: { lit: "true" } },
        ],
        blockIndices: [0, 1, 0],
        blockEntityCount: 1,
      },
    ];

    const result = parseLitematic(createLitematicFixture({ regions }));
    expect(result.regions).toHaveLength(2);
    expect(countFor(result.blockStateCounts, "minecraft:oak_log", { axis: "y" })).toBe(4);
    expect(countFor(result.blockStateCounts, "examplemod:glowing_block", { lit: "true" })).toBe(1);
    expect(result.regions[0]?.entityCount).toBe(2);
    expect(result.regions[1]?.blockEntityCount).toBe(1);
    expect(result.preview.bounds).toEqual({
      min: { x: -6, y: 0, z: 0 },
      max: { x: 2, y: 0, z: 0 },
    });
    expect(result.warnings).toEqual([]);
  });

  it("warns for missing metadata, unknown versions, and invalid palette indices", () => {
    const fixture = createLitematicFixture({
      version: 999,
      metadata: false,
      regions: [
        {
          name: "Warnings",
          size: { x: 3, y: 1, z: 1 },
          palette: [
            { name: "minecraft:air" },
            { name: "minecraft:stone" },
            { name: "minecraft:dirt" },
          ],
          // A two-bit value of 3 exists but is outside this three-entry palette.
          blockIndices: [0, 3, 1],
        },
      ],
    });

    const result = parseLitematic(fixture);
    expect(result.metadata.name).toBeNull();
    expect(result.warnings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "MISSING_METADATA",
        "UNKNOWN_FORMAT_VERSION",
        "PALETTE_INDEX_OUT_OF_RANGE",
      ]),
    );
    expect(result.stats.invalidPaletteIndexCount).toBe(1);
  });

  it("rejects corrupt gzip and configurable region-volume abuse", () => {
    const fixture = createLitematicFixture();
    const corrupt = fixture.slice();
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0xff;
    expect(() => parseLitematic(corrupt)).toThrowError(GzipError);
    expect(() => parseLitematic(fixture, { maxRegionVolume: 3 })).toThrowError(
      expect.objectContaining({ code: "REGION_VOLUME_LIMIT" }),
    );
  });
});
