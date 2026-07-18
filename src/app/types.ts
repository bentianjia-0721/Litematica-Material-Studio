export type ProcessingStage =
  | "读取文件"
  | "解压 gzip"
  | "解析 NBT"
  | "识别版本"
  | "加载物品数据"
  | "解码方块状态"
  | "统计材料"
  | "生成结果";

export interface StudioMetadata {
  name: string;
  author: string;
  description: string;
  timeCreated: number | null;
  timeModified: number | null;
  formatVersion: number | null;
  subVersion: number | null;
  minecraftDataVersion: number | null;
  regionCount: number;
  enclosingSize: { x: number; y: number; z: number };
  totalVolume: number;
  totalBlocks: number;
}

export type DataStatus = "准确" | "兼容版本" | "模组" | "用户设置" | "未知";

export interface StudioMaterial {
  id: string;
  displayName: string;
  displayNameEn?: string;
  iconPath?: string;
  required: number;
  owned: number;
  remaining: number;
  maxStackSize: number | null;
  status: DataStatus;
  warning?: string;
}

export interface StudioCatalogItem {
  id: string;
  numericId: number | null;
  displayName: string;
  displayNameEn: string;
  maxStackSize: number | null;
  iconPath?: string;
  iconSourceVersion?: string;
  isBlock: boolean;
}

export interface StudioProject {
  projectId: string;
  fileName: string;
  fileSize: number;
  metadata: StudioMetadata;
  detectedVersion: string | null;
  dataVersion: string | null;
  matchType: "exact" | "compatible" | "inferred" | "unknown";
  materials: StudioMaterial[];
  warnings: string[];
}

export interface WorkerProgressMessage {
  type: "progress";
  stage: ProcessingStage;
  progress: number;
  detail?: string;
}

export interface WorkerResultMessage {
  type: "result";
  payload: unknown;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
  stack?: string;
}

export type WorkerResponse = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;
