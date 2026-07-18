import { describe, expect, it } from "vitest";
import type { BlockState, LitematicPreviewBounds } from "../src/lib/litematic";
import {
  blockStateColor,
  countVisibleBlocks,
  resolveLayerRange,
} from "../src/features/schematic-preview/preview-model";

const bounds: LitematicPreviewBounds = {
  min: { x: -3, y: -64, z: 8 },
  max: { x: 12, y: 12, z: 20 },
};

describe("schematic preview layer model", () => {
  it("resolves all, single and reversed multi-layer selections inclusively", () => {
    expect(
      resolveLayerRange({ mode: "all", singleLayer: 0, rangeStart: 0, rangeEnd: 0 }, bounds),
    ).toEqual({ min: -64, max: 12 });
    expect(
      resolveLayerRange({ mode: "single", singleLayer: -15, rangeStart: 0, rangeEnd: 0 }, bounds),
    ).toEqual({ min: -15, max: -15 });
    expect(
      resolveLayerRange({ mode: "range", singleLayer: 0, rangeStart: 8, rangeEnd: -3 }, bounds),
    ).toEqual({ min: -3, max: 8 });
  });

  it("clamps layer input to actual schematic Y bounds", () => {
    expect(
      resolveLayerRange({ mode: "range", singleLayer: 0, rangeStart: -999, rangeEnd: 999 }, bounds),
    ).toEqual({ min: -64, max: 12 });
  });

  it("counts both endpoints and supports empty layers", () => {
    const positions = new Int32Array([0, -2, 0, 1, -1, 0, 2, 0, 0, 3, 4, 0]);
    expect(countVisibleBlocks(positions, { min: -1, max: 0 })).toBe(2);
    expect(countVisibleBlocks(positions, { min: 1, max: 3 })).toBe(0);
  });

  it("assigns stable category colours while retaining mod states", () => {
    const state = (name: string): BlockState => ({ key: name, name, properties: {} });
    expect(blockStateColor(state("minecraft:water"))).toBe(0x3f8fe8);
    expect(blockStateColor(state("minecraft:nether_portal"))).toBe(0x9c67e8);
    expect(blockStateColor(state("examplemod:machine"))).toBe(
      blockStateColor(state("examplemod:machine")),
    );
  });
});
