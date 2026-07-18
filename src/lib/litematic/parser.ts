import {
  bitsPerPaletteEntry,
  forEachPackedPaletteIndex,
  requiredPackedLongs,
} from "./block-states";
import { decompressGzip } from "./gzip";
import {
  isNbtCompoundTag,
  isNbtListTag,
  NbtTagType,
  parseNbt,
  type NbtCompound,
  type NbtCompoundTag,
  type NbtTag,
} from "./nbt";
import {
  LitematicParseError,
  type BlockState,
  type BlockStateCount,
  type LitematicMetadata,
  type LitematicParseOptions,
  type LitematicPreview,
  type LitematicPreviewBounds,
  type LitematicParseResult,
  type LitematicRegion,
  type LitematicWarning,
  type LitematicWarningCode,
  type Vector3i,
} from "./types";

const DEFAULT_MAX_REGION_VOLUME = 50_000_000;
const DEFAULT_MAX_TOTAL_VOLUME = 100_000_000;
const DEFAULT_MAX_PREVIEW_BLOCKS = 200_000;
const DEFAULT_SUPPORTED_FORMAT_VERSIONS = new Set([4, 5, 6, 7]);

interface MutableCount {
  readonly state: BlockState;
  count: number;
}

interface MutableStats {
  paletteEntryCount: number;
  totalVolume: number;
  decodedBlockCount: number;
  invalidPaletteIndexCount: number;
}

interface MutablePreview {
  readonly maxBlocks: number;
  readonly states: BlockState[];
  readonly stateIndexByKey: Map<string, number>;
  readonly positions: Int32Array;
  readonly stateIndices: Uint32Array;
  bounds: LitematicPreviewBounds | null;
  totalBlockCount: number;
  sampledBlockCount: number;
}

function resolvePositiveLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }

  return result;
}

function warning(
  warnings: LitematicWarning[],
  code: LitematicWarningCode,
  message: string,
  regionName: string | null = null,
): void {
  warnings.push({ code, message, regionName });
}

function getString(compound: NbtCompound, name: string): string | null {
  const tag = compound[name];
  return tag?.type === NbtTagType.String ? tag.value : null;
}

function getSafeInteger(compound: NbtCompound, name: string): number | null {
  const tag = compound[name];
  if (
    tag?.type === NbtTagType.Byte ||
    tag?.type === NbtTagType.Short ||
    tag?.type === NbtTagType.Int
  ) {
    return tag.value;
  }
  if (tag?.type === NbtTagType.Long) {
    const value = Number(tag.value);
    return Number.isSafeInteger(value) ? value : null;
  }

  return null;
}

function getBigInteger(compound: NbtCompound, name: string): bigint | null {
  const tag = compound[name];
  if (
    tag?.type === NbtTagType.Byte ||
    tag?.type === NbtTagType.Short ||
    tag?.type === NbtTagType.Int
  ) {
    return BigInt(tag.value);
  }
  if (tag?.type === NbtTagType.Long) {
    return tag.value;
  }

  return null;
}

function getCompound(compound: NbtCompound, name: string): NbtCompound | null {
  const tag = compound[name];
  return tag?.type === NbtTagType.Compound ? tag.value : null;
}

function readVector(tag: NbtTag | undefined): Vector3i | null {
  if (!isNbtCompoundTag(tag)) {
    return null;
  }

  const x = getSafeInteger(tag.value, "x");
  const y = getSafeInteger(tag.value, "y");
  const z = getSafeInteger(tag.value, "z");
  return x === null || y === null || z === null ? null : { x, y, z };
}

function canonicalStateKey(name: string, properties: Readonly<Record<string, string>>): string {
  return JSON.stringify([name, Object.entries(properties)]);
}

function placeholderPaletteState(regionName: string, index: number): BlockState {
  const name = `litematica:invalid_palette_entry_${index}`;
  const properties: Readonly<Record<string, string>> = Object.freeze({});
  return {
    name,
    properties,
    key: canonicalStateKey(`${name}@${regionName}`, properties),
  };
}

function parsePaletteEntry(
  tag: NbtTag,
  index: number,
  regionName: string,
  warnings: LitematicWarning[],
): BlockState {
  if (!isNbtCompoundTag(tag)) {
    warning(
      warnings,
      "INVALID_PALETTE_ENTRY",
      `Palette entry ${index} is not a compound`,
      regionName,
    );
    return placeholderPaletteState(regionName, index);
  }

  const storedName = getString(tag.value, "Name");
  if (storedName === null || storedName.length === 0) {
    warning(
      warnings,
      "INVALID_PALETTE_ENTRY",
      `Palette entry ${index} has no valid Name`,
      regionName,
    );
    return placeholderPaletteState(regionName, index);
  }

  const rawProperties = tag.value.Properties;
  const entries: [string, string][] = [];
  if (rawProperties !== undefined) {
    if (rawProperties.type !== NbtTagType.Compound) {
      warning(
        warnings,
        "INVALID_PALETTE_PROPERTY",
        `Properties for palette entry ${index} is not a compound`,
        regionName,
      );
    } else {
      for (const [propertyName, propertyTag] of Object.entries(rawProperties.value)) {
        if (propertyTag.type !== NbtTagType.String) {
          warning(
            warnings,
            "INVALID_PALETTE_PROPERTY",
            `Property ${JSON.stringify(propertyName)} for palette entry ${index} is not a string`,
            regionName,
          );
          continue;
        }
        entries.push([propertyName, propertyTag.value]);
      }
    }
  }

  entries.sort(([left], [right]) => left.localeCompare(right));
  const properties: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [propertyName, propertyValue] of entries) {
    properties[propertyName] = propertyValue;
  }

  return {
    name: storedName,
    properties,
    key: canonicalStateKey(storedName, properties),
  };
}

function readPalette(
  region: NbtCompound,
  regionName: string,
  warnings: LitematicWarning[],
): BlockState[] {
  const tag = region.BlockStatePalette;
  if (!isNbtListTag(tag) || tag.elementType !== NbtTagType.Compound) {
    warning(
      warnings,
      "EMPTY_PALETTE",
      "Region has no valid BlockStatePalette compound list",
      regionName,
    );
    return [];
  }

  if (tag.value.length === 0) {
    warning(warnings, "EMPTY_PALETTE", "Region palette is empty", regionName);
    return [];
  }

  return tag.value.map((entry, index) => parsePaletteEntry(entry, index, regionName, warnings));
}

function absoluteDimensions(size: Vector3i): Vector3i {
  return {
    x: Math.abs(size.x),
    y: Math.abs(size.y),
    z: Math.abs(size.z),
  };
}

function isPreviewAir(state: BlockState): boolean {
  return /^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(state.name);
}

function regionBounds(
  position: Vector3i,
  size: Vector3i,
  dimensions: Vector3i,
): LitematicPreviewBounds {
  const end = {
    x: position.x + (size.x < 0 ? -(dimensions.x - 1) : dimensions.x - 1),
    y: position.y + (size.y < 0 ? -(dimensions.y - 1) : dimensions.y - 1),
    z: position.z + (size.z < 0 ? -(dimensions.z - 1) : dimensions.z - 1),
  };

  return {
    min: {
      x: Math.min(position.x, end.x),
      y: Math.min(position.y, end.y),
      z: Math.min(position.z, end.z),
    },
    max: {
      x: Math.max(position.x, end.x),
      y: Math.max(position.y, end.y),
      z: Math.max(position.z, end.z),
    },
  };
}

function includeRegionBounds(
  preview: MutablePreview,
  position: Vector3i,
  size: Vector3i,
  dimensions: Vector3i,
): void {
  const next = regionBounds(position, size, dimensions);
  if (preview.bounds === null) {
    preview.bounds = next;
    return;
  }

  preview.bounds = {
    min: {
      x: Math.min(preview.bounds.min.x, next.min.x),
      y: Math.min(preview.bounds.min.y, next.min.y),
      z: Math.min(preview.bounds.min.z, next.min.z),
    },
    max: {
      x: Math.max(preview.bounds.max.x, next.max.x),
      y: Math.max(preview.bounds.max.y, next.max.y),
      z: Math.max(preview.bounds.max.z, next.max.z),
    },
  };
}

function previewStateIndex(preview: MutablePreview, state: BlockState): number {
  const existing = preview.stateIndexByKey.get(state.key);
  if (existing !== undefined) return existing;

  const index = preview.states.length;
  preview.states.push(state);
  preview.stateIndexByKey.set(state.key, index);
  return index;
}

/** Stable pseudo-random slot for deterministic reservoir sampling. */
function reservoirSlot(seen: number, x: number, y: number, z: number, stateIndex: number): number {
  let hash = 0x811c9dc5;
  for (const value of [seen, x, y, z, stateIndex]) {
    hash = Math.imul(hash ^ value, 0x01000193);
    hash = Math.imul(hash ^ (value / 0x1_0000_0000), 0x01000193);
  }
  return (hash >>> 0) % seen;
}

function includePreviewBlock(
  preview: MutablePreview,
  state: BlockState,
  x: number,
  y: number,
  z: number,
): void {
  preview.totalBlockCount += 1;
  const seen = preview.totalBlockCount;
  let slot: number;

  if (preview.sampledBlockCount < preview.maxBlocks) {
    slot = preview.sampledBlockCount;
    preview.sampledBlockCount += 1;
  } else {
    slot = reservoirSlot(seen, x, y, z, previewStateIndex(preview, state));
    if (slot >= preview.maxBlocks) return;
  }

  const stateIndex = previewStateIndex(preview, state);
  const coordinateOffset = slot * 3;
  preview.positions[coordinateOffset] = x;
  preview.positions[coordinateOffset + 1] = y;
  preview.positions[coordinateOffset + 2] = z;
  preview.stateIndices[slot] = stateIndex;
}

function finalizePreview(preview: MutablePreview): LitematicPreview {
  const stateIndices = new Uint32Array(preview.sampledBlockCount);
  const states: BlockState[] = [];
  const compactIndexByOriginal = new Map<number, number>();

  for (let index = 0; index < preview.sampledBlockCount; index += 1) {
    const originalIndex = preview.stateIndices[index] ?? 0;
    let compactIndex = compactIndexByOriginal.get(originalIndex);
    if (compactIndex === undefined) {
      compactIndex = states.length;
      const state = preview.states[originalIndex];
      if (state === undefined) {
        throw new Error(`Preview state index ${originalIndex} is missing`);
      }
      states.push(state);
      compactIndexByOriginal.set(originalIndex, compactIndex);
    }
    stateIndices[index] = compactIndex;
  }

  return {
    states,
    positions: preview.positions.slice(0, preview.sampledBlockCount * 3),
    stateIndices,
    bounds: preview.bounds,
    totalBlockCount: preview.totalBlockCount,
    sampledBlockCount: preview.sampledBlockCount,
    truncated: preview.totalBlockCount > preview.sampledBlockCount,
  };
}

function calculateRegionVolume(
  dimensions: Vector3i,
  regionName: string,
  maxRegionVolume: number,
): number {
  const volume = BigInt(dimensions.x) * BigInt(dimensions.y) * BigInt(dimensions.z);
  if (volume > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LitematicParseError(
      "INVALID_REGION_VOLUME",
      `Region ${JSON.stringify(regionName)} volume exceeds JavaScript's safe integer range`,
      regionName,
    );
  }

  const numericVolume = Number(volume);
  if (numericVolume > maxRegionVolume) {
    throw new LitematicParseError(
      "REGION_VOLUME_LIMIT",
      `Region ${JSON.stringify(regionName)} contains ${numericVolume} positions; limit is ${maxRegionVolume}`,
      regionName,
    );
  }

  return numericVolume;
}

function listLength(compound: NbtCompound, ...names: readonly string[]): number {
  for (const name of names) {
    const tag = compound[name];
    if (tag?.type === NbtTagType.List) {
      return tag.value.length;
    }
  }

  return 0;
}

function incrementCount(
  counts: Map<string, MutableCount>,
  state: BlockState,
  amount: number,
): void {
  const existing = counts.get(state.key);
  if (existing === undefined) {
    counts.set(state.key, { state, count: amount });
  } else {
    existing.count += amount;
  }
}

function finalizeCounts(counts: ReadonlyMap<string, MutableCount>): BlockStateCount[] {
  return [...counts.values()]
    .map(({ state, count }) => ({ ...state, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function parseRegion(
  regionName: string,
  tag: NbtCompoundTag,
  warnings: LitematicWarning[],
  stats: MutableStats,
  aggregateCounts: Map<string, MutableCount>,
  preview: MutablePreview,
  maxRegionVolume: number,
  maxTotalVolume: number,
): LitematicRegion {
  const region = tag.value;
  const position = readVector(region.Position);
  if (position === null) {
    warning(warnings, "MISSING_POSITION", "Region has no valid Position", regionName);
  }

  const size = readVector(region.Size);
  if (size === null) {
    warning(warnings, "MISSING_SIZE", "Region has no valid Size", regionName);
  }

  const dimensions = size === null ? null : absoluteDimensions(size);
  const volume =
    dimensions === null ? 0 : calculateRegionVolume(dimensions, regionName, maxRegionVolume);

  if (volume > 0 && position !== null && size !== null && dimensions !== null) {
    includeRegionBounds(preview, position, size, dimensions);
  }

  stats.totalVolume += volume;
  if (stats.totalVolume > maxTotalVolume) {
    throw new LitematicParseError(
      "TOTAL_VOLUME_LIMIT",
      `All regions contain ${stats.totalVolume} positions; limit is ${maxTotalVolume}`,
      regionName,
    );
  }

  const palette = readPalette(region, regionName, warnings);
  stats.paletteEntryCount += palette.length;
  const localCounts = new Map<string, MutableCount>();

  if (volume > 0 && palette.length > 0) {
    const blockStates = region.BlockStates;
    if (blockStates?.type !== NbtTagType.LongArray) {
      throw new LitematicParseError(
        "MISSING_BLOCK_STATES",
        `Region ${JSON.stringify(regionName)} has no valid BlockStates long array`,
        regionName,
      );
    }

    const bits = bitsPerPaletteEntry(palette.length);
    const requiredLongs = requiredPackedLongs(volume, bits);
    if (blockStates.value.length > requiredLongs) {
      warning(
        warnings,
        "EXTRA_BLOCK_STATE_DATA",
        `BlockStates has ${blockStates.value.length - requiredLongs} unused trailing long(s)`,
        regionName,
      );
    }

    let invalidInRegion = 0;
    forEachPackedPaletteIndex(
      blockStates.value,
      volume,
      palette.length,
      (paletteIndex, blockIndex) => {
        stats.decodedBlockCount += 1;
        const state = palette[paletteIndex];
        if (state === undefined) {
          invalidInRegion += 1;
          stats.invalidPaletteIndexCount += 1;
          return;
        }

        incrementCount(localCounts, state, 1);
        incrementCount(aggregateCounts, state, 1);

        if (position !== null && size !== null && dimensions !== null && !isPreviewAir(state)) {
          // Litematica stores x as the fastest-changing axis, followed by z and y.
          const localX = blockIndex % dimensions.x;
          const localZ = Math.floor(blockIndex / dimensions.x) % dimensions.z;
          const localY = Math.floor(blockIndex / (dimensions.x * dimensions.z));
          includePreviewBlock(
            preview,
            state,
            position.x + (size.x < 0 ? -localX : localX),
            position.y + (size.y < 0 ? -localY : localY),
            position.z + (size.z < 0 ? -localZ : localZ),
          );
        }
      },
    );

    if (invalidInRegion > 0) {
      warning(
        warnings,
        "PALETTE_INDEX_OUT_OF_RANGE",
        `${invalidInRegion} block position(s) reference a palette index outside 0..${palette.length - 1}`,
        regionName,
      );
    }
  }

  return {
    name: regionName,
    position,
    size,
    dimensions,
    volume,
    palette,
    blockStateCounts: finalizeCounts(localCounts),
    entityCount: listLength(region, "Entities"),
    blockEntityCount: listLength(region, "BlockEntities", "TileEntities"),
    pendingBlockTickCount: listLength(region, "PendingBlockTicks"),
    pendingFluidTickCount: listLength(region, "PendingFluidTicks"),
  };
}

function extractMetadata(
  root: NbtCompound,
  inputBytes: number,
  fileName: string | undefined,
  warnings: LitematicWarning[],
): LitematicMetadata {
  const metadata = getCompound(root, "Metadata");
  if (metadata === null) {
    warning(warnings, "MISSING_METADATA", "Litematic has no Metadata compound");
  }

  const source = metadata ?? (Object.create(null) as NbtCompound);
  const enclosingSize = readVector(source.EnclosingSize) ?? readVector(source.Size);

  return {
    name: getString(source, "Name"),
    author: getString(source, "Author"),
    description: getString(source, "Description"),
    timeCreated: getBigInteger(source, "TimeCreated"),
    timeModified: getBigInteger(source, "TimeModified"),
    formatVersion: getSafeInteger(root, "Version"),
    subVersion: getSafeInteger(root, "SubVersion"),
    minecraftDataVersion:
      getSafeInteger(root, "MinecraftDataVersion") ?? getSafeInteger(root, "DataVersion"),
    regionCount: getSafeInteger(source, "RegionCount"),
    enclosingSize,
    totalVolume: getBigInteger(source, "TotalVolume"),
    totalBlocks: getBigInteger(source, "TotalBlocks"),
    originalFileName: fileName ?? null,
    originalFileSize: inputBytes,
  };
}

/** Parse a complete gzip-compressed .litematic file in the browser. */
export function parseLitematic(
  input: Uint8Array | ArrayBuffer,
  options: LitematicParseOptions = {},
): LitematicParseResult {
  const compressedBytes = input instanceof Uint8Array ? input.byteLength : input.byteLength;
  const decompressed = decompressGzip(input, options.gzip);
  const parsedNbt = parseNbt(decompressed, options.nbt);

  if (parsedNbt.tag.type !== NbtTagType.Compound) {
    throw new LitematicParseError(
      "INVALID_NBT_ROOT",
      `Litematic root must be TAG_Compound, not tag type ${parsedNbt.tag.type}`,
    );
  }

  const warnings: LitematicWarning[] = [];
  const root = parsedNbt.tag.value;
  const metadata = extractMetadata(root, compressedBytes, options.fileName, warnings);

  if (metadata.formatVersion === null) {
    warning(warnings, "MISSING_FORMAT_VERSION", "Litematic has no numeric Version tag");
  } else {
    const supportedVersions =
      options.supportedFormatVersions === undefined
        ? DEFAULT_SUPPORTED_FORMAT_VERSIONS
        : new Set(options.supportedFormatVersions);
    if (!supportedVersions.has(metadata.formatVersion)) {
      warning(
        warnings,
        "UNKNOWN_FORMAT_VERSION",
        `Litematic format version ${metadata.formatVersion} is not in the supported-version list`,
      );
    }
  }

  const maxRegionVolume = resolvePositiveLimit(
    options.maxRegionVolume,
    DEFAULT_MAX_REGION_VOLUME,
    "maxRegionVolume",
  );
  const maxTotalVolume = resolvePositiveLimit(
    options.maxTotalVolume,
    DEFAULT_MAX_TOTAL_VOLUME,
    "maxTotalVolume",
  );
  const maxPreviewBlocks = Math.min(
    resolvePositiveLimit(options.maxPreviewBlocks, DEFAULT_MAX_PREVIEW_BLOCKS, "maxPreviewBlocks"),
    DEFAULT_MAX_PREVIEW_BLOCKS,
  );
  const stats: MutableStats = {
    paletteEntryCount: 0,
    totalVolume: 0,
    decodedBlockCount: 0,
    invalidPaletteIndexCount: 0,
  };
  const aggregateCounts = new Map<string, MutableCount>();
  const preview: MutablePreview = {
    maxBlocks: maxPreviewBlocks,
    states: [],
    stateIndexByKey: new Map(),
    positions: new Int32Array(maxPreviewBlocks * 3),
    stateIndices: new Uint32Array(maxPreviewBlocks),
    bounds: null,
    totalBlockCount: 0,
    sampledBlockCount: 0,
  };
  const regions: LitematicRegion[] = [];
  const regionsTag = root.Regions;

  if (!isNbtCompoundTag(regionsTag)) {
    warning(warnings, "MISSING_REGIONS", "Litematic has no Regions compound");
  } else {
    for (const [regionName, regionTag] of Object.entries(regionsTag.value)) {
      if (!isNbtCompoundTag(regionTag)) {
        warning(
          warnings,
          "INVALID_REGION",
          `Region ${JSON.stringify(regionName)} is not a compound and was skipped`,
          regionName,
        );
        continue;
      }

      regions.push(
        parseRegion(
          regionName,
          regionTag,
          warnings,
          stats,
          aggregateCounts,
          preview,
          maxRegionVolume,
          maxTotalVolume,
        ),
      );
    }
  }

  if (metadata.regionCount !== null && metadata.regionCount !== regions.length) {
    warning(
      warnings,
      "REGION_COUNT_MISMATCH",
      `Metadata says ${metadata.regionCount} region(s), but ${regions.length} were parsed`,
    );
  }
  if (metadata.totalVolume !== null && metadata.totalVolume !== BigInt(stats.totalVolume)) {
    warning(
      warnings,
      "TOTAL_VOLUME_MISMATCH",
      `Metadata TotalVolume is ${metadata.totalVolume}, but parsed regions total ${stats.totalVolume}`,
    );
  }

  return {
    metadata,
    regions,
    blockStateCounts: finalizeCounts(aggregateCounts),
    preview: finalizePreview(preview),
    warnings,
    stats: {
      compressedBytes,
      decompressedBytes: decompressed.byteLength,
      nbtBytesRead: parsedNbt.bytesRead,
      parsedRegionCount: regions.length,
      paletteEntryCount: stats.paletteEntryCount,
      totalVolume: stats.totalVolume,
      decodedBlockCount: stats.decodedBlockCount,
      invalidPaletteIndexCount: stats.invalidPaletteIndexCount,
    },
  };
}
