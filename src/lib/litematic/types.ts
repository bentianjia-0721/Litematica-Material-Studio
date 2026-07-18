import type { GzipLimits } from "./gzip";
import type { NbtParseOptions } from "./nbt";

export interface Vector3i {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlockState {
  readonly key: string;
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
}

export interface BlockStateCount extends BlockState {
  readonly count: number;
}

export interface LitematicMetadata {
  readonly name: string | null;
  readonly author: string | null;
  readonly description: string | null;
  /** Raw signed NBT long. Litematica normally stores epoch milliseconds. */
  readonly timeCreated: bigint | null;
  /** Raw signed NBT long. Litematica normally stores epoch milliseconds. */
  readonly timeModified: bigint | null;
  readonly formatVersion: number | null;
  readonly subVersion: number | null;
  readonly minecraftDataVersion: number | null;
  readonly regionCount: number | null;
  readonly enclosingSize: Vector3i | null;
  /** Preserved as bigint because metadata may use either TAG_Int or TAG_Long. */
  readonly totalVolume: bigint | null;
  /** Preserved as bigint because metadata may use either TAG_Int or TAG_Long. */
  readonly totalBlocks: bigint | null;
  readonly originalFileName: string | null;
  readonly originalFileSize: number;
}

export interface LitematicRegion {
  readonly name: string;
  readonly position: Vector3i | null;
  /** Signed region size as stored by Litematica. */
  readonly size: Vector3i | null;
  /** Absolute dimensions used to compute volume. */
  readonly dimensions: Vector3i | null;
  readonly volume: number;
  readonly palette: readonly BlockState[];
  readonly blockStateCounts: readonly BlockStateCount[];
  readonly entityCount: number;
  readonly blockEntityCount: number;
  readonly pendingBlockTickCount: number;
  readonly pendingFluidTickCount: number;
}

export interface LitematicPreviewBounds {
  readonly min: Vector3i;
  readonly max: Vector3i;
}

/** Compact, capped non-air block data used only for the interactive preview. */
export interface LitematicPreview {
  readonly states: readonly BlockState[];
  /** Interleaved x/y/z world coordinates. Length is sampledBlockCount * 3. */
  readonly positions: Int32Array;
  readonly stateIndices: Uint32Array;
  /** Full schematic region bounds, including empty layers. */
  readonly bounds: LitematicPreviewBounds | null;
  readonly totalBlockCount: number;
  readonly sampledBlockCount: number;
  readonly truncated: boolean;
}

export type LitematicWarningCode =
  | "MISSING_FORMAT_VERSION"
  | "UNKNOWN_FORMAT_VERSION"
  | "MISSING_METADATA"
  | "MISSING_METADATA_FIELD"
  | "MISSING_REGIONS"
  | "INVALID_REGION"
  | "MISSING_POSITION"
  | "MISSING_SIZE"
  | "EMPTY_PALETTE"
  | "INVALID_PALETTE_ENTRY"
  | "INVALID_PALETTE_PROPERTY"
  | "EXTRA_BLOCK_STATE_DATA"
  | "PALETTE_INDEX_OUT_OF_RANGE"
  | "REGION_COUNT_MISMATCH"
  | "TOTAL_VOLUME_MISMATCH";

export interface LitematicWarning {
  readonly code: LitematicWarningCode;
  readonly message: string;
  readonly regionName: string | null;
}

export interface LitematicParseStats {
  readonly compressedBytes: number;
  readonly decompressedBytes: number;
  readonly nbtBytesRead: number;
  readonly parsedRegionCount: number;
  readonly paletteEntryCount: number;
  readonly totalVolume: number;
  readonly decodedBlockCount: number;
  readonly invalidPaletteIndexCount: number;
}

export interface LitematicParseResult {
  readonly metadata: LitematicMetadata;
  readonly regions: readonly LitematicRegion[];
  /** Counts include air. Filtering belongs to the material conversion layer. */
  readonly blockStateCounts: readonly BlockStateCount[];
  readonly preview: LitematicPreview;
  readonly warnings: readonly LitematicWarning[];
  readonly stats: LitematicParseStats;
}

export interface LitematicParseOptions {
  readonly fileName?: string;
  readonly gzip?: GzipLimits;
  readonly nbt?: NbtParseOptions;
  readonly maxRegionVolume?: number;
  readonly maxTotalVolume?: number;
  /** Maximum number of non-air positions retained for preview, capped at 200,000. */
  readonly maxPreviewBlocks?: number;
  readonly supportedFormatVersions?: readonly number[];
}

export type LitematicParseErrorCode =
  | "INVALID_NBT_ROOT"
  | "INVALID_REGION_VOLUME"
  | "REGION_VOLUME_LIMIT"
  | "TOTAL_VOLUME_LIMIT"
  | "MISSING_BLOCK_STATES";

export class LitematicParseError extends Error {
  readonly code: LitematicParseErrorCode;
  readonly regionName: string | null;

  constructor(
    code: LitematicParseErrorCode,
    message: string,
    regionName: string | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LitematicParseError";
    this.code = code;
    this.regionName = regionName;
  }
}
