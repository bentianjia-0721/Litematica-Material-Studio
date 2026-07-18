import type { MinecraftVersionData } from "../minecraft-data";

export type MaterialStatus = "verified" | "inferred" | "unknown" | "ignored";

export interface BlockStateCountLike {
  key?: string;
  name: string;
  properties?: Readonly<Record<string, string>>;
  count: number;
}

export type BlockStateCountsInput =
  Readonly<Record<string, number>> | ReadonlyMap<string, number> | readonly BlockStateCountLike[];

export interface NormalizedBlockStateCount {
  key: string;
  name: string;
  properties: Readonly<Record<string, string>>;
  count: number;
}

export interface BlockMaterialConversion {
  blockId: string;
  itemId: string | null;
  itemMultiplier: number | null;
  additionalItems?: ReadonlyArray<{
    itemId: string;
    itemMultiplier: number;
  }>;
  status: MaterialStatus;
  warnings: string[];
  ignoredReason?: string;
}

export interface MaterialRow {
  id: string;
  /** Preferred display name (zh-CN, then English, then raw ID). */
  name: string;
  nameZhCn?: string;
  nameEn: string;
  /** UI compatibility aliases. */
  displayName: string;
  displayNameEn: string;
  iconPath?: string;
  maxStackSize: number | null;
  status: Exclude<MaterialStatus, "ignored">;
  required: number;
  warnings: string[];
  warning?: string;
  sourceBlockIds: string[];
}

export interface MaterialConversionOptions {
  maxStackOverrides?: Readonly<Record<string, number | null>>;
  /** Used only as a safety ceiling for hostile or corrupt input. */
  maxQuantity?: number;
}

export interface MaterialConversionContext {
  versionData: MinecraftVersionData;
  options?: MaterialConversionOptions;
}
