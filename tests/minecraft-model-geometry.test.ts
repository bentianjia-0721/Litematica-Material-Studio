import { Color, type BufferGeometry } from "three";
import type { ResolvedBlockModel } from "mc-assets";
import { describe, expect, it } from "vitest";
import type { BlockState } from "../src/lib/litematic";
import {
  bakeMinecraftModelGeometry,
  resolveMinecraftTintColor,
  type MinecraftAtlasTexture,
} from "../src/features/schematic-preview/minecraft-model-geometry";

const state = (name: string, properties: Readonly<Record<string, string>> = {}): BlockState => ({
  key: `${name}${JSON.stringify(properties)}`,
  name,
  properties,
});

const atlas: Readonly<Record<string, MinecraftAtlasTexture>> = {
  stone: { u: 0.2, v: 0.3, su: 0.1, sv: 0.1, imageType: "latest" },
  observer_front: { u: 0.5, v: 0.1, su: 0.2, sv: 0.2, imageType: "legacy" },
  water_still: { u: 0.05, v: 0.6, su: 0.1, sv: 0.1, imageType: "latest" },
  redstone_dust: { u: 0.75, v: 0.1, su: 0.1, sv: 0.1, imageType: "latest" },
};

const getTexture = (name: string): MinecraftAtlasTexture | undefined => atlas[name];

function cubeFaces(
  overrides: Partial<Record<string, string>> = {},
): Record<string, { texture: string }> {
  return Object.fromEntries(
    ["down", "up", "north", "south", "west", "east"].map((face) => [
      face,
      { texture: overrides[face] ?? "block/stone" },
    ]),
  );
}

function observerModel(y?: number): ResolvedBlockModel {
  return {
    modelName: "block/observer",
    ...(y === undefined ? {} : { y }),
    textures: { stone: "block/stone", front: "block/observer_front" },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: cubeFaces({ north: "#front" }),
      },
    ],
  };
}

function normalAt(geometry: BufferGeometry, index = 0): readonly number[] {
  const normal = geometry.getAttribute("normal");
  return [normal.getX(index), normal.getY(index), normal.getZ(index)];
}

function allPositions(geometries: readonly BufferGeometry[]): number[][] {
  return geometries.flatMap((geometry) => {
    const positions = geometry.getAttribute("position");
    return Array.from({ length: positions.count }, (_, index) => [
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index),
    ]);
  });
}

describe("minecraft model geometry baker", () => {
  it("keeps an observer north face north and turns it east for blockstate y=90", () => {
    const north = bakeMinecraftModelGeometry(
      state("minecraft:observer"),
      [observerModel()],
      getTexture,
    );
    const east = bakeMinecraftModelGeometry(
      state("minecraft:observer", { facing: "east" }),
      [observerModel(90)],
      getTexture,
    );

    expect(north.geometries?.legacy).toBeDefined();
    expect(east.geometries?.legacy).toBeDefined();
    expect(normalAt(north.geometries!.legacy!)).toEqual([0, 0, -1]);
    const eastNormal = normalAt(east.geometries!.legacy!);
    expect(eastNormal[0]).toBeCloseTo(1, 6);
    expect(eastNormal[1]).toBeCloseTo(0, 6);
    expect(eastNormal[2]).toBeCloseTo(0, 6);

    const positions = allPositions([east.geometries!.latest!, east.geometries!.legacy!]);
    for (const axis of [0, 1, 2] as const) {
      expect(Math.min(...positions.map((position) => position[axis]!))).toBeCloseTo(-0.5, 6);
      expect(Math.max(...positions.map((position) => position[axis]!))).toBeCloseTo(0.5, 6);
    }
  });

  it("preserves stair elements instead of replacing them with a full cube", () => {
    const stair: ResolvedBlockModel = {
      modelName: "block/oak_stairs",
      elements: [
        { from: [0, 0, 0], to: [16, 8, 16], faces: cubeFaces() },
        { from: [0, 8, 8], to: [16, 16, 16], faces: cubeFaces() },
      ],
    };
    const result = bakeMinecraftModelGeometry(state("minecraft:oak_stairs"), [stair], getTexture);
    const geometry = result.geometries?.latest;

    expect(result.faceCount).toBe(12);
    expect(geometry?.getAttribute("position").count).toBe(72);
    const positions = allPositions([geometry!]);
    expect(positions.some(([x, y, z]) => x === -0.5 && y === 0 && z === 0)).toBe(true);
    expect(new Set(positions.map((position) => position[1])).size).toBe(3);
  });

  it("merges multipart models, splits atlas groups and keeps rotated UVs inside each tile", () => {
    const latestPart: ResolvedBlockModel = {
      modelName: "block/latest_part",
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: { north: { texture: "block/stone", uv: [2, 4, 14, 12], rotation: 90 } },
        },
      ],
    };
    const legacyPart: ResolvedBlockModel = {
      modelName: "block/legacy_part",
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          rotation: { origin: [8, 8, 8], axis: "y", angle: 22.5, rescale: true },
          faces: { south: { texture: "block/observer_front", uv: [4, 2, 12, 14] } },
        },
      ],
    };
    const result = bakeMinecraftModelGeometry(
      state("minecraft:test_multipart"),
      [latestPart, legacyPart],
      getTexture,
    );

    expect(result.faceCount).toBe(2);
    expect(result.geometries?.latest).toBeDefined();
    expect(result.geometries?.legacy).toBeDefined();

    const assertUvRange = (
      geometry: BufferGeometry,
      uMin: number,
      uMax: number,
      vMin: number,
      vMax: number,
    ): void => {
      const uv = geometry.getAttribute("uv");
      for (let index = 0; index < uv.count; index += 1) {
        expect(uv.getX(index)).toBeGreaterThanOrEqual(uMin);
        expect(uv.getX(index)).toBeLessThanOrEqual(uMax);
        expect(uv.getY(index)).toBeGreaterThanOrEqual(vMin);
        expect(uv.getY(index)).toBeLessThanOrEqual(vMax);
      }
    };
    assertUvRange(result.geometries!.latest!, 0.2, 0.3, 0.6, 0.7);
    assertUvRange(result.geometries!.legacy!, 0.5, 0.7, 0.7, 0.9);

    const rotatedPositions = allPositions([result.geometries!.legacy!]);
    expect(
      rotatedPositions.some(
        (position) => Math.abs(position[0]!) > 0.5 || Math.abs(position[2]!) > 0.5,
      ),
    ).toBe(true);
  });

  it("uses grass, foliage, water and powered-redstone tints", () => {
    expect(resolveMinecraftTintColor(state("minecraft:grass_block"), 0)).toBe(0x91bd59);
    expect(resolveMinecraftTintColor(state("minecraft:oak_leaves"), 0)).toBe(0x77ab2f);
    expect(resolveMinecraftTintColor(state("minecraft:water"), 0)).toBe(0x3f76e4);
    expect(resolveMinecraftTintColor(state("minecraft:redstone_wire", { power: "15" }), 0)).toBe(
      0xff3300,
    );

    const redstone: ResolvedBlockModel = {
      modelName: "block/redstone_wire",
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 1, 16],
          faces: { up: { texture: "block/redstone_dust", tintindex: 0 } },
        },
      ],
    };
    const result = bakeMinecraftModelGeometry(
      state("minecraft:redstone_wire", { power: "15" }),
      [redstone],
      getTexture,
    );
    const colors = result.geometries!.latest!.getAttribute("color");
    const expected = new Color(0xff3300);
    expect(colors.getX(0)).toBeCloseTo(expected.r, 6);
    expect(colors.getY(0)).toBeCloseTo(expected.g, 6);
    expect(colors.getZ(0)).toBeCloseTo(expected.b, 6);
  });

  it("generates textured vanilla fluid geometry but reports genuinely missing models", () => {
    const water = bakeMinecraftModelGeometry(
      state("minecraft:bubble_column"),
      undefined,
      getTexture,
    );
    expect(water.faceCount).toBe(6);
    expect(water.geometries?.latest).toBeDefined();
    expect(water.missing).toBeNull();

    const expectedWater = new Color(0x3f76e4);
    const colors = water.geometries!.latest!.getAttribute("color");
    expect(colors.getX(0)).toBeCloseTo(expectedWater.r, 6);
    expect(colors.getY(0)).toBeCloseTo(expectedWater.g, 6);
    expect(colors.getZ(0)).toBeCloseTo(expectedWater.b, 6);

    const missing = bakeMinecraftModelGeometry(
      state("minecraft:structure_void"),
      undefined,
      getTexture,
    );
    expect(missing.geometries).toBeNull();
    expect(missing.missing).toMatchObject({
      reason: "missing-model",
      missingTextureIds: [],
    });
  });

  it("keeps partial geometry and reports texture IDs for skipped faces", () => {
    const partial: ResolvedBlockModel = {
      modelName: "block/partial",
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            north: { texture: "block/stone" },
            south: { texture: "block/not_in_atlas" },
          },
        },
      ],
    };
    const result = bakeMinecraftModelGeometry(state("minecraft:test"), [partial], getTexture);
    expect(result.faceCount).toBe(1);
    expect(result.geometries?.latest).toBeDefined();
    expect(result.missing).toEqual({
      stateKey: "minecraft:test{}",
      reason: "missing-textures",
      missingTextureIds: ["block/not_in_atlas"],
      skippedFaceCount: 1,
    });
  });
});
