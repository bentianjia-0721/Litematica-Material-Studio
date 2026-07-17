export enum NbtTagType {
  End = 0,
  Byte = 1,
  Short = 2,
  Int = 3,
  Long = 4,
  Float = 5,
  Double = 6,
  ByteArray = 7,
  String = 8,
  List = 9,
  Compound = 10,
  IntArray = 11,
  LongArray = 12,
}

export interface NbtEndTag {
  readonly type: NbtTagType.End;
  readonly value: null;
}

export interface NbtByteTag {
  readonly type: NbtTagType.Byte;
  readonly value: number;
}

export interface NbtShortTag {
  readonly type: NbtTagType.Short;
  readonly value: number;
}

export interface NbtIntTag {
  readonly type: NbtTagType.Int;
  readonly value: number;
}

export interface NbtLongTag {
  readonly type: NbtTagType.Long;
  readonly value: bigint;
}

export interface NbtFloatTag {
  readonly type: NbtTagType.Float;
  readonly value: number;
}

export interface NbtDoubleTag {
  readonly type: NbtTagType.Double;
  readonly value: number;
}

export interface NbtByteArrayTag {
  readonly type: NbtTagType.ByteArray;
  readonly value: Int8Array;
}

export interface NbtStringTag {
  readonly type: NbtTagType.String;
  readonly value: string;
}

export interface NbtListTag {
  readonly type: NbtTagType.List;
  readonly elementType: NbtTagType;
  readonly value: readonly NbtTag[];
}

export type NbtCompound = Readonly<Record<string, NbtTag>>;

export interface NbtCompoundTag {
  readonly type: NbtTagType.Compound;
  readonly value: NbtCompound;
}

export interface NbtIntArrayTag {
  readonly type: NbtTagType.IntArray;
  readonly value: Int32Array;
}

export interface NbtLongArrayTag {
  readonly type: NbtTagType.LongArray;
  readonly value: readonly bigint[];
}

export type NbtTag =
  | NbtEndTag
  | NbtByteTag
  | NbtShortTag
  | NbtIntTag
  | NbtLongTag
  | NbtFloatTag
  | NbtDoubleTag
  | NbtByteArrayTag
  | NbtStringTag
  | NbtListTag
  | NbtCompoundTag
  | NbtIntArrayTag
  | NbtLongArrayTag;

export interface NamedNbtTag {
  readonly name: string;
  readonly tag: Exclude<NbtTag, NbtEndTag>;
}

export interface ParsedNbt extends NamedNbtTag {
  readonly bytesRead: number;
  readonly trailingBytes: number;
}

export interface NbtParseLimits {
  /** Maximum nesting level, where the root tag is at depth zero. */
  readonly maxDepth?: number;
  /** Maximum entries in any list or primitive array. */
  readonly maxCollectionLength?: number;
  /** Maximum number of named entries in one compound. */
  readonly maxCompoundEntries?: number;
  /** Maximum UTF-8/MUTF-8 encoded bytes in one name or string. */
  readonly maxStringBytes?: number;
  /** Maximum total tag payloads visited across the document. */
  readonly maxTotalTags?: number;
  /** Maximum total uncompressed NBT input bytes. */
  readonly maxInputBytes?: number;
}

export interface NbtParseOptions {
  readonly limits?: NbtParseLimits;
  readonly allowTrailingBytes?: boolean;
}

export type NbtErrorCode =
  | "INVALID_ROOT"
  | "UNKNOWN_TAG"
  | "UNEXPECTED_END"
  | "INVALID_LENGTH"
  | "DEPTH_LIMIT"
  | "COLLECTION_LIMIT"
  | "COMPOUND_LIMIT"
  | "STRING_LIMIT"
  | "TAG_LIMIT"
  | "INPUT_LIMIT"
  | "INVALID_STRING"
  | "DUPLICATE_KEY"
  | "TRAILING_DATA";

export class NbtParseError extends Error {
  readonly code: NbtErrorCode;
  readonly offset: number;

  constructor(code: NbtErrorCode, message: string, offset: number) {
    super(`${message} (at byte ${offset})`);
    this.name = "NbtParseError";
    this.code = code;
    this.offset = offset;
  }
}

interface ResolvedNbtLimits {
  readonly maxDepth: number;
  readonly maxCollectionLength: number;
  readonly maxCompoundEntries: number;
  readonly maxStringBytes: number;
  readonly maxTotalTags: number;
  readonly maxInputBytes: number;
}

const DEFAULT_LIMITS: ResolvedNbtLimits = {
  maxDepth: 64,
  maxCollectionLength: 16_777_216,
  maxCompoundEntries: 1_000_000,
  maxStringBytes: 1_048_576,
  maxTotalTags: 10_000_000,
  maxInputBytes: 512 * 1024 * 1024,
};

function resolveLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }

  return result;
}

function resolveLimits(limits: NbtParseLimits = {}): ResolvedNbtLimits {
  return {
    maxDepth: resolveLimit(limits.maxDepth, DEFAULT_LIMITS.maxDepth, "maxDepth"),
    maxCollectionLength: resolveLimit(
      limits.maxCollectionLength,
      DEFAULT_LIMITS.maxCollectionLength,
      "maxCollectionLength",
    ),
    maxCompoundEntries: resolveLimit(
      limits.maxCompoundEntries,
      DEFAULT_LIMITS.maxCompoundEntries,
      "maxCompoundEntries",
    ),
    maxStringBytes: resolveLimit(
      limits.maxStringBytes,
      DEFAULT_LIMITS.maxStringBytes,
      "maxStringBytes",
    ),
    maxTotalTags: resolveLimit(limits.maxTotalTags, DEFAULT_LIMITS.maxTotalTags, "maxTotalTags"),
    maxInputBytes: resolveLimit(
      limits.maxInputBytes,
      DEFAULT_LIMITS.maxInputBytes,
      "maxInputBytes",
    ),
  };
}

function isKnownTagType(value: number): value is NbtTagType {
  return value >= 0 && value <= 12;
}

/** Decode Java's modified UTF-8 while also accepting standard four-byte UTF-8. */
function decodeNbtString(bytes: Uint8Array, offset: number): string {
  const codeUnits: number[] = [];

  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];

    if (first === undefined) {
      break;
    }

    if (first <= 0x7f) {
      codeUnits.push(first);
      index += 1;
      continue;
    }

    if ((first & 0xe0) === 0xc0) {
      const second = bytes[index + 1];
      if (second === undefined || (second & 0xc0) !== 0x80) {
        throw new NbtParseError(
          "INVALID_STRING",
          "Invalid two-byte UTF-8 sequence",
          offset + index,
        );
      }

      const value = ((first & 0x1f) << 6) | (second & 0x3f);
      // C0 80 is the MUTF-8 encoding of NUL; other overlong encodings are invalid.
      if (value < 0x80 && !(first === 0xc0 && second === 0x80)) {
        throw new NbtParseError("INVALID_STRING", "Overlong UTF-8 sequence", offset + index);
      }

      codeUnits.push(value);
      index += 2;
      continue;
    }

    if ((first & 0xf0) === 0xe0) {
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      if (
        second === undefined ||
        third === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80
      ) {
        throw new NbtParseError(
          "INVALID_STRING",
          "Invalid three-byte UTF-8 sequence",
          offset + index,
        );
      }

      const value = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (value < 0x800) {
        throw new NbtParseError("INVALID_STRING", "Overlong UTF-8 sequence", offset + index);
      }

      // Surrogate code units are intentional in MUTF-8 and combine naturally in JS.
      codeUnits.push(value);
      index += 3;
      continue;
    }

    if ((first & 0xf8) === 0xf0) {
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      const fourth = bytes[index + 3];
      if (
        second === undefined ||
        third === undefined ||
        fourth === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (fourth & 0xc0) !== 0x80
      ) {
        throw new NbtParseError(
          "INVALID_STRING",
          "Invalid four-byte UTF-8 sequence",
          offset + index,
        );
      }

      const codePoint =
        ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
      if (codePoint < 0x10000 || codePoint > 0x10ffff) {
        throw new NbtParseError("INVALID_STRING", "Invalid UTF-8 code point", offset + index);
      }

      const adjusted = codePoint - 0x10000;
      codeUnits.push(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      index += 4;
      continue;
    }

    throw new NbtParseError("INVALID_STRING", "Invalid UTF-8 leading byte", offset + index);
  }

  // Avoid exceeding the argument limit of String.fromCharCode on long strings.
  let result = "";
  const chunkSize = 8_192;
  for (let index = 0; index < codeUnits.length; index += chunkSize) {
    result += String.fromCharCode(...codeUnits.slice(index, index + chunkSize));
  }

  return result;
}

class NbtReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #limits: ResolvedNbtLimits;
  #offset = 0;
  #totalTags = 0;

  constructor(bytes: Uint8Array, limits: ResolvedNbtLimits) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#limits = limits;
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#bytes.byteLength - this.#offset;
  }

  readRoot(): NamedNbtTag {
    const rawType = this.#readUint8();
    if (rawType === 0) {
      throw new NbtParseError("INVALID_ROOT", "Root tag cannot be TAG_End", this.#offset - 1);
    }
    if (!isKnownTagType(rawType)) {
      throw new NbtParseError(
        "UNKNOWN_TAG",
        `Unknown NBT root tag type ${rawType}`,
        this.#offset - 1,
      );
    }

    const name = this.#readString();
    return { name, tag: this.#readPayload(rawType, 0) as Exclude<NbtTag, NbtEndTag> };
  }

  #ensure(byteLength: number): void {
    if (byteLength < 0 || this.#offset + byteLength > this.#bytes.byteLength) {
      throw new NbtParseError(
        "UNEXPECTED_END",
        `NBT data is truncated; needed ${byteLength} more byte(s)`,
        this.#offset,
      );
    }
  }

  #countTag(): void {
    this.#totalTags += 1;
    if (this.#totalTags > this.#limits.maxTotalTags) {
      throw new NbtParseError(
        "TAG_LIMIT",
        `NBT contains more than ${this.#limits.maxTotalTags} tags`,
        this.#offset,
      );
    }
  }

  #checkDepth(depth: number): void {
    if (depth > this.#limits.maxDepth) {
      throw new NbtParseError(
        "DEPTH_LIMIT",
        `NBT nesting depth exceeds ${this.#limits.maxDepth}`,
        this.#offset,
      );
    }
  }

  #readTagType(allowEnd: boolean): NbtTagType {
    const value = this.#readUint8();
    if (!isKnownTagType(value) || (!allowEnd && value === NbtTagType.End)) {
      throw new NbtParseError(
        "UNKNOWN_TAG",
        `Unknown or invalid NBT tag type ${value}`,
        this.#offset - 1,
      );
    }

    return value;
  }

  #readUint8(): number {
    this.#ensure(1);
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  #readInt8(): number {
    this.#ensure(1);
    const value = this.#view.getInt8(this.#offset);
    this.#offset += 1;
    return value;
  }

  #readUint16(): number {
    this.#ensure(2);
    const value = this.#view.getUint16(this.#offset, false);
    this.#offset += 2;
    return value;
  }

  #readInt16(): number {
    this.#ensure(2);
    const value = this.#view.getInt16(this.#offset, false);
    this.#offset += 2;
    return value;
  }

  #readInt32(): number {
    this.#ensure(4);
    const value = this.#view.getInt32(this.#offset, false);
    this.#offset += 4;
    return value;
  }

  #readBigInt64(): bigint {
    this.#ensure(8);
    const value = this.#view.getBigInt64(this.#offset, false);
    this.#offset += 8;
    return value;
  }

  #readFloat32(): number {
    this.#ensure(4);
    const value = this.#view.getFloat32(this.#offset, false);
    this.#offset += 4;
    return value;
  }

  #readFloat64(): number {
    this.#ensure(8);
    const value = this.#view.getFloat64(this.#offset, false);
    this.#offset += 8;
    return value;
  }

  #readLength(context: string): number {
    const value = this.#readInt32();
    if (value < 0) {
      throw new NbtParseError(
        "INVALID_LENGTH",
        `${context} has negative length ${value}`,
        this.#offset - 4,
      );
    }
    if (value > this.#limits.maxCollectionLength) {
      throw new NbtParseError(
        "COLLECTION_LIMIT",
        `${context} length ${value} exceeds ${this.#limits.maxCollectionLength}`,
        this.#offset - 4,
      );
    }

    return value;
  }

  #readString(): string {
    const byteLength = this.#readUint16();
    if (byteLength > this.#limits.maxStringBytes) {
      throw new NbtParseError(
        "STRING_LIMIT",
        `NBT string length ${byteLength} exceeds ${this.#limits.maxStringBytes}`,
        this.#offset - 2,
      );
    }

    this.#ensure(byteLength);
    const start = this.#offset;
    const value = decodeNbtString(this.#bytes.subarray(start, start + byteLength), start);
    this.#offset += byteLength;
    return value;
  }

  #readPayload(type: NbtTagType, depth: number): NbtTag {
    this.#checkDepth(depth);
    this.#countTag();

    switch (type) {
      case NbtTagType.End:
        return { type, value: null };
      case NbtTagType.Byte:
        return { type, value: this.#readInt8() };
      case NbtTagType.Short:
        return { type, value: this.#readInt16() };
      case NbtTagType.Int:
        return { type, value: this.#readInt32() };
      case NbtTagType.Long:
        return { type, value: this.#readBigInt64() };
      case NbtTagType.Float:
        return { type, value: this.#readFloat32() };
      case NbtTagType.Double:
        return { type, value: this.#readFloat64() };
      case NbtTagType.ByteArray: {
        const length = this.#readLength("TAG_Byte_Array");
        this.#ensure(length);
        const value = new Int8Array(length);
        value.set(this.#bytes.subarray(this.#offset, this.#offset + length));
        this.#offset += length;
        return { type, value };
      }
      case NbtTagType.String:
        return { type, value: this.#readString() };
      case NbtTagType.List: {
        const elementType = this.#readTagType(true);
        const length = this.#readLength("TAG_List");
        if (elementType === NbtTagType.End && length !== 0) {
          throw new NbtParseError(
            "UNKNOWN_TAG",
            "A non-empty TAG_List cannot contain TAG_End",
            this.#offset - 5,
          );
        }

        const value: NbtTag[] = [];
        for (let index = 0; index < length; index += 1) {
          value.push(this.#readPayload(elementType, depth + 1));
        }
        return { type, elementType, value };
      }
      case NbtTagType.Compound: {
        const value: Record<string, NbtTag> = Object.create(null) as Record<string, NbtTag>;
        let entryCount = 0;

        while (true) {
          const childType = this.#readTagType(true);
          if (childType === NbtTagType.End) {
            break;
          }

          entryCount += 1;
          if (entryCount > this.#limits.maxCompoundEntries) {
            throw new NbtParseError(
              "COMPOUND_LIMIT",
              `TAG_Compound contains more than ${this.#limits.maxCompoundEntries} entries`,
              this.#offset,
            );
          }

          const name = this.#readString();
          if (Object.hasOwn(value, name)) {
            throw new NbtParseError(
              "DUPLICATE_KEY",
              `Duplicate compound key ${JSON.stringify(name)}`,
              this.#offset,
            );
          }
          value[name] = this.#readPayload(childType, depth + 1);
        }

        return { type, value };
      }
      case NbtTagType.IntArray: {
        const length = this.#readLength("TAG_Int_Array");
        this.#ensure(length * 4);
        const value = new Int32Array(length);
        for (let index = 0; index < length; index += 1) {
          value[index] = this.#readInt32();
        }
        return { type, value };
      }
      case NbtTagType.LongArray: {
        const length = this.#readLength("TAG_Long_Array");
        this.#ensure(length * 8);
        const value: bigint[] = [];
        for (let index = 0; index < length; index += 1) {
          value.push(this.#readBigInt64());
        }
        return { type, value };
      }
    }
  }
}

/** Parses an uncompressed, big-endian Java NBT document. */
export function parseNbt(
  input: Uint8Array | ArrayBuffer,
  options: NbtParseOptions = {},
): ParsedNbt {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const limits = resolveLimits(options.limits);

  if (bytes.byteLength > limits.maxInputBytes) {
    throw new NbtParseError(
      "INPUT_LIMIT",
      `NBT input is ${bytes.byteLength} bytes; limit is ${limits.maxInputBytes}`,
      0,
    );
  }

  const reader = new NbtReader(bytes, limits);
  const root = reader.readRoot();
  const trailingBytes = reader.remaining;

  if (trailingBytes !== 0 && options.allowTrailingBytes !== true) {
    throw new NbtParseError(
      "TRAILING_DATA",
      `NBT document has ${trailingBytes} trailing byte(s)`,
      reader.offset,
    );
  }

  return {
    ...root,
    bytesRead: reader.offset,
    trailingBytes,
  };
}

export function isNbtCompoundTag(tag: NbtTag | undefined): tag is NbtCompoundTag {
  return tag?.type === NbtTagType.Compound;
}

export function isNbtListTag(tag: NbtTag | undefined): tag is NbtListTag {
  return tag?.type === NbtTagType.List;
}
