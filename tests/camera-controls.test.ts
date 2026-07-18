import { describe, expect, it } from "vitest";

import { clampCameraDistance } from "../src/features/schematic-preview/camera-controls";

describe("schematic preview camera controls", () => {
  it("applies exactly one multiplicative zoom step", () => {
    expect(clampCameraDistance(10, 0.8, 1, 100)).toBe(8);
    expect(clampCameraDistance(10, 1.25, 1, 100)).toBe(12.5);
  });

  it("clamps repeated commands to the OrbitControls limits", () => {
    expect(clampCameraDistance(1.1, 0.5, 1, 20)).toBe(1);
    expect(clampCameraDistance(19, 2, 1, 20)).toBe(20);
  });

  it("does not turn an invalid command into a continuing camera mutation", () => {
    expect(clampCameraDistance(10, 0, 1, 20)).toBe(10);
    expect(clampCameraDistance(10, Number.NaN, 1, 20)).toBe(10);
  });
});
