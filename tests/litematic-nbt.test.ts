import { gzip } from "pako";
import { describe, expect, it } from "vitest";

import {
  decompressGzip,
  GzipError,
  NbtParseError,
  NbtTagType,
  parseNbt,
} from "../src/lib/litematic";
import { encodeNbt, fixtureTag } from "./fixtures/litematic-fixture";

describe("NBT parser", () => {
  it("parses every standard payload and preserves signed 64-bit values as bigint", () => {
    const encoded = encodeNbt(
      "完整😀",
      fixtureTag.compound({
        byte: fixtureTag.byte(-128),
        short: fixtureTag.short(-32_000),
        int: fixtureTag.int(-2_000_000_000),
        longMin: fixtureTag.long(-(1n << 63n)),
        longMax: fixtureTag.long((1n << 63n) - 1n),
        float: fixtureTag.float(1.25),
        double: fixtureTag.double(Math.PI),
        bytes: fixtureTag.byteArray([-128, -1, 0, 127]),
        string: fixtureTag.string("中文😀\0"),
        list: fixtureTag.list(NbtTagType.Int, [fixtureTag.int(1), fixtureTag.int(2)]),
        compound: fixtureTag.compound({ nested: fixtureTag.string("yes") }),
        ints: fixtureTag.intArray([-2_147_483_648, 0, 2_147_483_647]),
        longs: fixtureTag.longArray([-1n, 0n, (1n << 63n) - 1n]),
      }),
    );

    const parsed = parseNbt(encoded);
    expect(parsed.name).toBe("完整😀");
    expect(parsed.trailingBytes).toBe(0);
    expect(parsed.tag.type).toBe(NbtTagType.Compound);
    if (parsed.tag.type !== NbtTagType.Compound) {
      throw new Error("expected compound");
    }

    expect(parsed.tag.value.byte).toEqual({ type: NbtTagType.Byte, value: -128 });
    expect(parsed.tag.value.longMin).toEqual({
      type: NbtTagType.Long,
      value: -(1n << 63n),
    });
    expect(parsed.tag.value.longMax).toEqual({
      type: NbtTagType.Long,
      value: (1n << 63n) - 1n,
    });
    expect(parsed.tag.value.bytes?.value).toEqual(Int8Array.from([-128, -1, 0, 127]));
    expect(parsed.tag.value.ints?.value).toEqual(
      Int32Array.from([-2_147_483_648, 0, 2_147_483_647]),
    );
    expect(parsed.tag.value.longs?.value).toEqual([-1n, 0n, (1n << 63n) - 1n]);
    expect(parsed.tag.value.string).toEqual({
      type: NbtTagType.String,
      value: "中文😀\0",
    });
  });

  it("rejects truncated documents, negative lengths, trailing bytes, and configured limits", () => {
    const encoded = encodeNbt("", fixtureTag.compound({ array: fixtureTag.intArray([1, 2, 3]) }));

    expect(() => parseNbt(encoded.subarray(0, encoded.length - 1))).toThrowError(NbtParseError);
    expect(() => parseNbt(Uint8Array.from([...encoded, 0]))).toThrowError(
      expect.objectContaining({ code: "TRAILING_DATA" }),
    );
    expect(() => parseNbt(encoded, { limits: { maxCollectionLength: 2 } })).toThrowError(
      expect.objectContaining({ code: "COLLECTION_LIMIT" }),
    );

    // Root compound -> named TAG_Byte_Array "a" -> signed length -1.
    const negativeLength = Uint8Array.from([
      NbtTagType.Compound,
      0,
      0,
      NbtTagType.ByteArray,
      0,
      1,
      0x61,
      0xff,
      0xff,
      0xff,
      0xff,
    ]);
    expect(() => parseNbt(negativeLength)).toThrowError(
      expect.objectContaining({ code: "INVALID_LENGTH" }),
    );

    const nested = encodeNbt(
      "",
      fixtureTag.compound({ child: fixtureTag.compound({ value: fixtureTag.int(1) }) }),
    );
    expect(() => parseNbt(nested, { limits: { maxDepth: 0 } })).toThrowError(
      expect.objectContaining({ code: "DEPTH_LIMIT" }),
    );
  });
});

describe("gzip wrapper", () => {
  it("decompresses genuine gzip and enforces an output bound", () => {
    const raw = new TextEncoder().encode("litematic".repeat(1_000));
    const compressed = gzip(raw);
    const decompressed = decompressGzip(compressed);
    expect(decompressed.byteLength).toBe(raw.byteLength);
    expect(Array.from(decompressed)).toEqual(Array.from(raw));
    expect(() => decompressGzip(compressed, { maxOutputBytes: raw.length - 1 })).toThrowError(
      expect.objectContaining({ code: "DECOMPRESSED_SIZE_LIMIT" }),
    );
  });

  it("rejects non-gzip and corrupt gzip data", () => {
    expect(() => decompressGzip(Uint8Array.from([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "INVALID_GZIP" }),
    );

    const compressed = gzip(new TextEncoder().encode("payload"));
    const corrupt = compressed.slice();
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0xff;
    expect(() => decompressGzip(corrupt)).toThrowError(GzipError);
  });
});
