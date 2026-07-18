export type DataConfidence = "verified" | "cross-checked" | "inferred";

export type VersionMatchType = "exact" | "compatible" | "inferred" | "unknown";

export type VersionSupportStatus =
  "fully-supported" | "partially-supported" | "unverified" | "unsupported";

export interface VersionedItemData {
  numericId: number | null;
  name: string;
  displayNameEn: string;
  displayNameZhCn?: string;
  maxStackSize: number | null;
  blockNames?: string[];
  itemModel?: string;
  textureKey?: string;
  iconPath?: string;
  iconSourceVersion?: string;
  iconSourceUrl?: string;
  introducedIn?: string;
  removedIn?: string;
  dataSource: string;
  confidence: DataConfidence;
}

export interface VersionedBlockData {
  numericId: number | null;
  name: string;
  displayNameEn: string;
  itemId: string | null;
  minStateId?: number;
  maxStateId?: number;
  dataSource: string;
  confidence: DataConfidence;
}

export interface MinecraftVersionData {
  schemaVersion: 1;
  /** Compatibility alias of minecraftVersion for app/worker consumers. */
  version: string;
  minecraftVersion: string;
  dataVersion: number | null;
  protocolVersion: number | null;
  generatedAt: string;
  sources: string[];
  items: Record<string, VersionedItemData>;
  blocks: Record<string, VersionedBlockData>;
  blockToItem: Record<string, string>;
  legacyBlockIds: Record<string, string>;
}

export interface MinecraftVersionSummary {
  version: string;
  dataVersion: number | null;
  protocolVersion: number | null;
  itemCount: number;
  blockCount: number;
  zhCnItemCount?: number;
  iconItemCount?: number;
  iconSourceVersion?: string;
  dataFile: string;
  dataSource: string;
  supportStatus: VersionSupportStatus;
}

export interface DataVersionEntry {
  minecraftVersion: string;
  dataVersion: number;
  protocolVersion: number | null;
  majorVersion: string;
  releaseType: "release" | "snapshot" | "unknown";
}

export interface VersionDetectionOptions {
  formatVersion?: number | null;
  subVersion?: number | null;
  metadataVersion?: string | null;
  /** Maximum DataVersion distance accepted for a compatible suggestion. */
  compatibleDistance?: number;
}

export interface VersionCandidate {
  version: string;
  dataVersion: number | null;
  supportStatus: VersionSupportStatus;
  reason: string;
}

export interface VersionMatch {
  originalDataVersion: number | null;
  originalDetectedVersion: string | null;
  /** Automatically resolved local data version; never a user-selected override. */
  selectedVersion: string | null;
  /** Compatibility aliases of selectedVersion/matchType. */
  version: string | null;
  minecraftVersion: string | null;
  matchType: VersionMatchType;
  type: VersionMatchType;
  confidence: DataConfidence | "unknown";
  candidates: VersionCandidate[];
  warnings: string[];
  detectionHints: {
    formatVersion: number | null;
    subVersion: number | null;
    metadataVersion: string | null;
  };
}

export interface LitematicaCompatibilityEntry {
  litematicaVersion: string;
  minecraftVersion: string;
  minecraftDataVersion: number | null;
  litematicFormatVersion: number | null;
  litematicSubVersion: number | null;
  malilibVersion?: string;
  releaseDate?: string;
  sourceUrls: string[];
  confidence: DataConfidence;
  supportStatus: VersionSupportStatus;
}
