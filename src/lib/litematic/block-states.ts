export type PackedLongArray = readonly bigint[] | BigInt64Array;

export class BlockStateDecodeError extends Error {
  readonly code: "INVALID_PALETTE_SIZE" | "INVALID_BLOCK_COUNT" | "BLOCK_STATES_TOO_SHORT";

  constructor(code: BlockStateDecodeError["code"], message: string) {
    super(message);
    this.name = "BlockStateDecodeError";
    this.code = code;
  }
}

export function bitsPerPaletteEntry(paletteSize: number): number {
  if (!Number.isSafeInteger(paletteSize) || paletteSize <= 0) {
    throw new BlockStateDecodeError(
      "INVALID_PALETTE_SIZE",
      `Palette size must be a positive safe integer; received ${paletteSize}`,
    );
  }

  // Litematica/MaLiLib uses at least two bits even for tiny palettes.
  return Math.max(2, Math.ceil(Math.log2(paletteSize)));
}

export function requiredPackedLongs(blockCount: number, bitsPerEntry: number): number {
  if (!Number.isSafeInteger(blockCount) || blockCount < 0) {
    throw new BlockStateDecodeError(
      "INVALID_BLOCK_COUNT",
      `Block count must be a non-negative safe integer; received ${blockCount}`,
    );
  }
  if (!Number.isSafeInteger(bitsPerEntry) || bitsPerEntry <= 0 || bitsPerEntry > 32) {
    throw new RangeError("bitsPerEntry must be an integer between 1 and 32");
  }

  const totalBits = blockCount * bitsPerEntry;
  if (!Number.isSafeInteger(totalBits)) {
    throw new BlockStateDecodeError(
      "INVALID_BLOCK_COUNT",
      "Packed block-state bit length exceeds JavaScript's safe integer range",
    );
  }

  return Math.ceil(totalBits / 64);
}

function packedLongAt(data: PackedLongArray, index: number): bigint {
  const value = data[index];
  if (value === undefined) {
    throw new BlockStateDecodeError(
      "BLOCK_STATES_TOO_SHORT",
      `BlockStates is missing packed long at index ${index}`,
    );
  }

  // NBT longs are signed, but the backing bit storage is interpreted unsigned.
  return BigInt.asUintN(64, value);
}

/**
 * Returns one palette index from Litematica's contiguous bit array. Entries
 * are allowed to straddle two signed NBT longs.
 */
export function readPackedPaletteIndex(
  data: PackedLongArray,
  blockIndex: number,
  bitsPerEntry: number,
): number {
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    throw new BlockStateDecodeError(
      "INVALID_BLOCK_COUNT",
      `Block index must be a non-negative safe integer; received ${blockIndex}`,
    );
  }
  if (!Number.isSafeInteger(bitsPerEntry) || bitsPerEntry <= 0 || bitsPerEntry > 32) {
    throw new RangeError("bitsPerEntry must be an integer between 1 and 32");
  }

  const bitOffset = blockIndex * bitsPerEntry;
  if (!Number.isSafeInteger(bitOffset)) {
    throw new BlockStateDecodeError(
      "INVALID_BLOCK_COUNT",
      "Packed block-state offset exceeds JavaScript's safe integer range",
    );
  }

  const startLong = Math.floor(bitOffset / 64);
  const startBit = bitOffset % 64;
  const bitsInFirstLong = 64 - startBit;
  let value = packedLongAt(data, startLong) >> BigInt(startBit);

  if (bitsInFirstLong < bitsPerEntry) {
    value |= packedLongAt(data, startLong + 1) << BigInt(bitsInFirstLong);
  }

  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  return Number(value & mask);
}

export function forEachPackedPaletteIndex(
  data: PackedLongArray,
  blockCount: number,
  paletteSize: number,
  visit: (paletteIndex: number, blockIndex: number) => void,
): void {
  const bitsPerEntry = bitsPerPaletteEntry(paletteSize);
  const requiredLongs = requiredPackedLongs(blockCount, bitsPerEntry);

  if (data.length < requiredLongs) {
    throw new BlockStateDecodeError(
      "BLOCK_STATES_TOO_SHORT",
      `BlockStates has ${data.length} long(s), but ${requiredLongs} are required for ${blockCount} blocks`,
    );
  }

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    visit(readPackedPaletteIndex(data, blockIndex, bitsPerEntry), blockIndex);
  }
}

export function decodeBlockStates(
  data: PackedLongArray,
  blockCount: number,
  paletteSize: number,
): number[] {
  const result = new Array<number>(blockCount);
  forEachPackedPaletteIndex(data, blockCount, paletteSize, (paletteIndex, blockIndex) => {
    result[blockIndex] = paletteIndex;
  });
  return result;
}
