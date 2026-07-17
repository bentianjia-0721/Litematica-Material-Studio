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
    expect(result.warnings).toEqual([]);
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
