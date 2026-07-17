import { describe, expect, it } from "vitest";

import {
  bitsPerPaletteEntry,
  BlockStateDecodeError,
  decodeBlockStates,
  readPackedPaletteIndex,
  requiredPackedLongs,
} from "../src/lib/litematic";
import { packPaletteIndices } from "./fixtures/litematic-fixture";

describe("Litematica packed BlockStates", () => {
  it("uses the palette size (including non-powers of two) to choose a bit width", () => {
    expect(bitsPerPaletteEntry(1)).toBe(2);
    expect(bitsPerPaletteEntry(3)).toBe(2);
    expect(bitsPerPaletteEntry(5)).toBe(3);
    expect(bitsPerPaletteEntry(17)).toBe(5);
  });

  it("decodes entries that cross signed long boundaries", () => {
    const values = Array.from({ length: 90 }, (_, index) => (index * 7) % 17);
    const packed = packPaletteIndices(values, 17);

    // With five bits per entry, entry 12 starts at bit 60 and straddles longs.
    expect(readPackedPaletteIndex(packed, 12, 5)).toBe(values[12]);
    expect(packed.some((value) => value < 0n)).toBe(true);
    expect(decodeBlockStates(packed, values.length, 17)).toEqual(values);
    expect(packed).toHaveLength(requiredPackedLongs(values.length, 5));
  });

  it("rejects invalid counts, palette sizes, and short backing arrays", () => {
    expect(() => bitsPerPaletteEntry(0)).toThrowError(BlockStateDecodeError);
    expect(() => requiredPackedLongs(-1, 2)).toThrowError(BlockStateDecodeError);
    expect(() => decodeBlockStates([], 1, 2)).toThrowError(
      expect.objectContaining({ code: "BLOCK_STATES_TOO_SHORT" }),
    );
  });
});
