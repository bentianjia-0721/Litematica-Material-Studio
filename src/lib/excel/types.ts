export type ExcelDateValue = Date | string | number | null;

export interface ProjectionMetadata {
  name?: string | null;
  author?: string | null;
  description?: string | null;
  createdAt?: ExcelDateValue;
  modifiedAt?: ExcelDateValue;
  originalFileName?: string | null;
  fileSizeBytes?: number | null;
  dimensions?: {
    x: number;
    y: number;
    z: number;
  } | null;
  regionCount?: number | null;
  dataVersion?: number | null;
  detectedMinecraftVersion?: string | null;
  versionMatchType?: string | null;
  litematicFormatVersion?: number | null;
  litematicSubVersion?: number | null;
  totalVolume?: number | null;
  nonAirBlockCount?: number | null;
  materialCount?: number | null;
  unknownItemCount?: number | null;
  warnings?: readonly string[];
}

export interface ExcelMaterialRow {
  itemName: string;
  minecraftId: string;
  totalRequired: number;
  owned: number;
  maxStackSize: number | null;
  note?: string;
  unknownOrMod?: boolean;
}

export interface MaterialWorkbookInput {
  metadata: ProjectionMetadata;
  minecraftVersion: string;
  materials: readonly ExcelMaterialRow[];
  exportedAt?: Date;
  toolVersion?: string;
}

export interface DownloadMaterialWorkbookOptions {
  fileName?: string;
}
