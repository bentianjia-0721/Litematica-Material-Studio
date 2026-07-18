import { gzip } from "pako";

import {
  bitsPerPaletteEntry,
  NbtTagType,
  type NbtCompound,
  type NbtCompoundTag,
  type NbtTag,
  type Vector3i,
} from "../../src/lib/litematic";

function encodeModifiedUtf8(value: string): Uint8Array {
  const bytes: number[] = [];

  // Java DataOutput.writeUTF encodes UTF-16 code units (including each half of
  // a surrogate pair) and represents NUL as the overlong C0 80 sequence.
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0x01 && codeUnit <= 0x7f) {
      bytes.push(codeUnit);
    } else if (codeUnit <= 0x7ff) {
      bytes.push(0xc0 | (codeUnit >> 6), 0x80 | (codeUnit & 0x3f));
    } else {
      bytes.push(
        0xe0 | (codeUnit >> 12),
        0x80 | ((codeUnit >> 6) & 0x3f),
        0x80 | (codeUnit & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

class NbtWriter {
  readonly #bytes: number[] = [];

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  writeUint8(value: number): void {
    this.#bytes.push(value & 0xff);
  }

  writeInt8(value: number): void {
    this.writeUint8(value);
  }

  writeUint16(value: number): void {
    this.#bytes.push((value >>> 8) & 0xff, value & 0xff);
  }

  writeInt16(value: number): void {
    this.writeUint16(value);
  }

  writeInt32(value: number): void {
    this.#bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  writeBigInt64(value: bigint): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt.asIntN(64, value), false);
    this.writeBytes(bytes);
  }

  writeFloat32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, false);
    this.writeBytes(bytes);
  }

  writeFloat64(value: number): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    this.writeBytes(bytes);
  }

  writeBytes(bytes: Iterable<number>): void {
    for (const byte of bytes) {
      this.writeUint8(byte);
    }
  }

  writeString(value: string): void {
    const bytes = encodeModifiedUtf8(value);
    if (bytes.byteLength > 0xffff) {
      throw new RangeError("Fixture NBT string is too long");
    }
    this.writeUint16(bytes.byteLength);
    this.writeBytes(bytes);
  }

  writeNamedTag(name: string, tag: Exclude<NbtTag, { readonly type: NbtTagType.End }>): void {
    this.writeUint8(tag.type);
    this.writeString(name);
    this.writePayload(tag);
  }

  writePayload(tag: NbtTag): void {
    switch (tag.type) {
      case NbtTagType.End:
        return;
      case NbtTagType.Byte:
        this.writeInt8(tag.value);
        return;
      case NbtTagType.Short:
        this.writeInt16(tag.value);
        return;
      case NbtTagType.Int:
        this.writeInt32(tag.value);
        return;
      case NbtTagType.Long:
        this.writeBigInt64(tag.value);
        return;
      case NbtTagType.Float:
        this.writeFloat32(tag.value);
        return;
      case NbtTagType.Double:
        this.writeFloat64(tag.value);
        return;
      case NbtTagType.ByteArray:
        this.writeInt32(tag.value.length);
        this.writeBytes(tag.value);
        return;
      case NbtTagType.String:
        this.writeString(tag.value);
        return;
      case NbtTagType.List:
        this.writeUint8(tag.elementType);
        this.writeInt32(tag.value.length);
        for (const child of tag.value) {
          if (child.type !== tag.elementType) {
            throw new TypeError("Fixture TAG_List contains a mismatched element type");
          }
          this.writePayload(child);
        }
        return;
      case NbtTagType.Compound:
        for (const [name, child] of Object.entries(tag.value)) {
          if (child.type === NbtTagType.End) {
            throw new TypeError("TAG_End cannot be a named compound value");
          }
          this.writeNamedTag(name, child);
        }
        this.writeUint8(NbtTagType.End);
        return;
      case NbtTagType.IntArray:
        this.writeInt32(tag.value.length);
        for (const value of tag.value) {
          this.writeInt32(value);
        }
        return;
      case NbtTagType.LongArray:
        this.writeInt32(tag.value.length);
        for (const value of tag.value) {
          this.writeBigInt64(value);
        }
    }
  }
}

export function encodeNbt(
  rootName: string,
  root: Exclude<NbtTag, { readonly type: NbtTagType.End }>,
): Uint8Array {
  const writer = new NbtWriter();
  writer.writeNamedTag(rootName, root);
  return writer.toUint8Array();
}

export const fixtureTag = {
  byte: (value: number): NbtTag => ({ type: NbtTagType.Byte, value }),
  short: (value: number): NbtTag => ({ type: NbtTagType.Short, value }),
  int: (value: number): NbtTag => ({ type: NbtTagType.Int, value }),
  long: (value: bigint): NbtTag => ({ type: NbtTagType.Long, value }),
  float: (value: number): NbtTag => ({ type: NbtTagType.Float, value }),
  double: (value: number): NbtTag => ({ type: NbtTagType.Double, value }),
  byteArray: (value: readonly number[]): NbtTag => ({
    type: NbtTagType.ByteArray,
    value: Int8Array.from(value),
  }),
  string: (value: string): NbtTag => ({ type: NbtTagType.String, value }),
  list: (elementType: NbtTagType, value: readonly NbtTag[]): NbtTag => ({
    type: NbtTagType.List,
    elementType,
    value,
  }),
  compound: (value: NbtCompound): NbtCompoundTag => ({
    type: NbtTagType.Compound,
    value,
  }),
  intArray: (value: readonly number[]): NbtTag => ({
    type: NbtTagType.IntArray,
    value: Int32Array.from(value),
  }),
  longArray: (value: readonly bigint[]): NbtTag => ({
    type: NbtTagType.LongArray,
    value,
  }),
};

export interface FixturePaletteEntry {
  readonly name: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export interface FixtureRegion {
  readonly name: string;
  /** null omits Position; undefined keeps the fixture default at the origin. */
  readonly position?: Vector3i | null;
  readonly size: Vector3i;
  readonly palette: readonly FixturePaletteEntry[];
  readonly blockIndices: readonly number[];
  readonly entityCount?: number;
  readonly blockEntityCount?: number;
}

export interface FixtureMetadata {
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly timeCreated: bigint;
  readonly timeModified: bigint;
  readonly regionCount: number;
  readonly enclosingSize: Vector3i;
  readonly totalVolume: bigint;
  readonly totalBlocks: bigint;
}

export interface LitematicFixtureOptions {
  readonly rootName?: string;
  readonly version?: number;
  readonly subVersion?: number | null;
  readonly minecraftDataVersion?: number;
  readonly metadata?: false | Partial<FixtureMetadata>;
  readonly regions?: readonly FixtureRegion[];
  readonly rootExtras?: NbtCompound;
}

function volumeOf(size: Vector3i): number {
  return Math.abs(size.x) * Math.abs(size.y) * Math.abs(size.z);
}

/** Packs entries independently of the production decoder, including straddles. */
export function packPaletteIndices(indices: readonly number[], paletteSize: number): bigint[] {
  const bits = bitsPerPaletteEntry(paletteSize);
  const mask = (1n << BigInt(bits)) - 1n;
  let packed = 0n;

  indices.forEach((index, blockIndex) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 2 ** bits) {
      throw new RangeError(`Palette index ${index} does not fit in ${bits} bits`);
    }
    packed |= (BigInt(index) & mask) << BigInt(blockIndex * bits);
  });

  const longCount = Math.ceil((indices.length * bits) / 64);
  const result: bigint[] = [];
  for (let index = 0; index < longCount; index += 1) {
    result.push(BigInt.asIntN(64, packed >> BigInt(index * 64)));
  }
  return result;
}

function vectorTag(value: Vector3i): NbtCompoundTag {
  return fixtureTag.compound({
    x: fixtureTag.int(value.x),
    y: fixtureTag.int(value.y),
    z: fixtureTag.int(value.z),
  });
}

function emptyCompoundList(length: number): NbtTag {
  return fixtureTag.list(
    NbtTagType.Compound,
    Array.from({ length }, () => fixtureTag.compound({})),
  );
}

function paletteTag(palette: readonly FixturePaletteEntry[]): NbtTag {
  return fixtureTag.list(
    NbtTagType.Compound,
    palette.map((entry) => {
      const value: Record<string, NbtTag> = {
        Name: fixtureTag.string(entry.name),
      };
      if (entry.properties !== undefined) {
        const properties: Record<string, NbtTag> = {};
        for (const [name, propertyValue] of Object.entries(entry.properties)) {
          properties[name] = fixtureTag.string(propertyValue);
        }
        value.Properties = fixtureTag.compound(properties);
      }
      return fixtureTag.compound(value);
    }),
  );
}

function regionTag(region: FixtureRegion): NbtCompoundTag {
  const expectedVolume = volumeOf(region.size);
  if (region.blockIndices.length !== expectedVolume) {
    throw new RangeError(
      `Fixture region ${region.name} has ${region.blockIndices.length} indices for volume ${expectedVolume}`,
    );
  }
  if (region.palette.length === 0) {
    throw new RangeError("Fixture palettes must not be empty");
  }

  return fixtureTag.compound({
    ...(region.position === null
      ? {}
      : { Position: vectorTag(region.position ?? { x: 0, y: 0, z: 0 }) }),
    Size: vectorTag(region.size),
    BlockStatePalette: paletteTag(region.palette),
    BlockStates: fixtureTag.longArray(
      packPaletteIndices(region.blockIndices, region.palette.length),
    ),
    Entities: emptyCompoundList(region.entityCount ?? 0),
    TileEntities: emptyCompoundList(region.blockEntityCount ?? 0),
    PendingBlockTicks: emptyCompoundList(0),
    PendingFluidTicks: emptyCompoundList(0),
  });
}

const DEFAULT_REGION: FixtureRegion = {
  name: "Main",
  size: { x: 2, y: 1, z: 2 },
  palette: [{ name: "minecraft:air" }, { name: "minecraft:stone" }],
  blockIndices: [0, 1, 1, 0],
};

export function createLitematicFixture(options: LitematicFixtureOptions = {}): Uint8Array {
  const regions = options.regions ?? [DEFAULT_REGION];
  const totalVolume = regions.reduce((total, region) => total + BigInt(volumeOf(region.size)), 0n);
  const totalBlocks = regions.reduce((total, region) => {
    const nonAir = region.blockIndices.filter(
      (index) => region.palette[index]?.name !== "minecraft:air",
    ).length;
    return total + BigInt(nonAir);
  }, 0n);
  const metadataDefaults: FixtureMetadata = {
    name: "Litematica fixture",
    author: "Vitest",
    description: "Real gzip-compressed NBT fixture",
    timeCreated: 1_700_000_000_000n,
    timeModified: 1_700_000_001_000n,
    regionCount: regions.length,
    enclosingSize: {
      x: regions.reduce((total, region) => total + Math.abs(region.size.x), 0),
      y: Math.max(0, ...regions.map((region) => Math.abs(region.size.y))),
      z: Math.max(0, ...regions.map((region) => Math.abs(region.size.z))),
    },
    totalVolume,
    totalBlocks,
  };
  const regionCompound: Record<string, NbtTag> = {};
  for (const region of regions) {
    regionCompound[region.name] = regionTag(region);
  }

  const root: Record<string, NbtTag> = {
    Version: fixtureTag.int(options.version ?? 6),
    MinecraftDataVersion: fixtureTag.int(options.minecraftDataVersion ?? 3953),
    Regions: fixtureTag.compound(regionCompound),
    ...options.rootExtras,
  };
  if (options.subVersion !== null) {
    root.SubVersion = fixtureTag.int(options.subVersion ?? 1);
  }
  if (options.metadata !== false) {
    const metadata = { ...metadataDefaults, ...options.metadata };
    root.Metadata = fixtureTag.compound({
      Name: fixtureTag.string(metadata.name),
      Author: fixtureTag.string(metadata.author),
      Description: fixtureTag.string(metadata.description),
      TimeCreated: fixtureTag.long(metadata.timeCreated),
      TimeModified: fixtureTag.long(metadata.timeModified),
      RegionCount: fixtureTag.int(metadata.regionCount),
      EnclosingSize: vectorTag(metadata.enclosingSize),
      TotalVolume: fixtureTag.long(metadata.totalVolume),
      TotalBlocks: fixtureTag.long(metadata.totalBlocks),
    });
  }

  return gzip(encodeNbt(options.rootName ?? "Litematic", fixtureTag.compound(root)));
}
