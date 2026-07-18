import { describe, expect, it } from "vitest";

import { parseLitematic } from "../src/lib/litematic";
import { parseResultTransferables } from "../src/workers/protocol";
import { createLitematicFixture } from "./fixtures/litematic-fixture";

describe("parse worker protocol", () => {
  it("transfers both typed-array buffers used by the schematic preview", () => {
    const result = parseLitematic(createLitematicFixture());
    const transferables = parseResultTransferables(result);

    expect(transferables).toEqual([
      result.preview.positions.buffer,
      result.preview.stateIndices.buffer,
    ]);
    expect(transferables).toHaveLength(2);
    expect(transferables.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
  });
});
