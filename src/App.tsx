import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "./components/Brand";
import type { ProcessingStage, StudioMaterial, StudioMetadata, StudioProject } from "./app/types";
import { UploadPanel } from "./features/upload/UploadPanel";
import { readFileAsArrayBuffer } from "./features/upload/read-file";
import { ProcessingPanel } from "./features/progress/ProcessingPanel";
import { SchematicHeader } from "./features/schematic-info/SchematicHeader";
import { MaterialTable } from "./features/material-table/MaterialTable";
import { ModResourceImporter } from "./features/mod-resources/ModResourceImporter";
import {
  MaterialToolbar,
  type MaterialFilter,
  type MaterialSort,
} from "./features/material-table/MaterialToolbar";
import { fileHash } from "./lib/storage";
import type { WorkerResponse } from "./workers/protocol";
import type { LitematicMetadata, LitematicParseResult } from "./lib/litematic";
import type { ModMaterialResource, ModResourceImportResult } from "./lib/mod-resources";

type Phase = "upload" | "processing" | "results";

interface MaterialWire {
  id: string;
  name?: string;
  nameZhCn?: string;
  nameEn?: string;
  iconPath?: string;
  maxStackSize: number | null;
  status: "verified" | "inferred" | "unknown" | "ignored";
  required: number;
  warnings?: string[];
}

interface VersionMatchWire {
  originalDetectedVersion: string | null;
  minecraftVersion: string | null;
  matchType: StudioProject["matchType"];
  type: StudioProject["matchType"];
  warnings?: string[];
}

interface SavedProgress {
  schemaVersion: 1;
  fileName: string;
  owned: Record<string, number>;
  maxStackOverrides?: Record<string, number>;
  savedAt: number;
}

const LAST_PROJECT_KEY = "lms:last-project";
const progressKey = (projectId: string) => `lms:progress:${projectId}`;

function loadSavedProgress(projectId: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(projectId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedProgress>;
    if (value.schemaVersion !== 1 || !value.owned || typeof value.owned !== "object") return null;
    return value as SavedProgress;
  } catch {
    return null;
  }
}

function safeNumber(value: number | bigint | null | undefined) {
  if (typeof value === "bigint") {
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(value > maximum ? maximum : value < -maximum ? -maximum : value);
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeMetadata(metadata: LitematicMetadata): StudioMetadata {
  const size = metadata.enclosingSize;
  return {
    name: String(metadata.name ?? "未命名投影"),
    author: String(metadata.author ?? ""),
    description: String(metadata.description ?? ""),
    timeCreated: metadata.timeCreated === null ? null : safeNumber(metadata.timeCreated),
    timeModified: metadata.timeModified === null ? null : safeNumber(metadata.timeModified),
    formatVersion: typeof metadata.formatVersion === "number" ? metadata.formatVersion : null,
    subVersion: typeof metadata.subVersion === "number" ? metadata.subVersion : null,
    minecraftDataVersion:
      typeof metadata.minecraftDataVersion === "number" ? metadata.minecraftDataVersion : null,
    regionCount: Math.max(0, Number(metadata.regionCount ?? 0)),
    enclosingSize: {
      x: Math.abs(Number(size?.x ?? 0)),
      y: Math.abs(Number(size?.y ?? 0)),
      z: Math.abs(Number(size?.z ?? 0)),
    },
    totalVolume: Math.max(0, safeNumber(metadata.totalVolume)),
    totalBlocks: Math.max(0, safeNumber(metadata.totalBlocks)),
  };
}

function metadataFromParsed(parsed: LitematicParseResult): StudioMetadata {
  const normalized = normalizeMetadata(parsed.metadata);
  const nonAirBlocks = parsed.blockStateCounts
    .filter((entry) => !/^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(entry.name))
    .reduce((sum, entry) => sum + entry.count, 0);
  const bounds = (["x", "y", "z"] as const).map((axis) => {
    const intervals = parsed.regions.flatMap((region) => {
      if (!region.position || !region.size || region.size[axis] === 0) return [];
      const start = region.position[axis];
      const end = start + Math.sign(region.size[axis]) * (Math.abs(region.size[axis]) - 1);
      return [[Math.min(start, end), Math.max(start, end)] as const];
    });
    if (!intervals.length) return 0;
    return (
      Math.max(...intervals.map((interval) => interval[1])) -
      Math.min(...intervals.map((interval) => interval[0])) +
      1
    );
  });
  return {
    ...normalized,
    regionCount: parsed.metadata.regionCount ?? parsed.stats.parsedRegionCount,
    totalVolume:
      parsed.metadata.totalVolume === null ? parsed.stats.totalVolume : normalized.totalVolume,
    totalBlocks: parsed.metadata.totalBlocks === null ? nonAirBlocks : normalized.totalBlocks,
    enclosingSize:
      parsed.metadata.enclosingSize === null
        ? { x: bounds[0] ?? 0, y: bounds[1] ?? 0, z: bounds[2] ?? 0 }
        : normalized.enclosingSize,
  };
}

function normalizeMaterials(
  rows: readonly MaterialWire[],
  owned: Record<string, number> = {},
  maxStackOverrides: Record<string, number> = {},
) {
  return rows
    .filter((row) => row.status !== "ignored" && row.required > 0)
    .map<StudioMaterial>((row) => {
      const required = Math.max(0, Math.floor(row.required));
      const currentOwned = Math.min(required, Math.max(0, Math.floor(owned[row.id] ?? 0)));
      const override = maxStackOverrides[row.id];
      const status = override
        ? "用户设置"
        : row.status === "verified"
          ? "准确"
          : row.status === "inferred"
            ? "兼容版本"
            : "未知";
      return {
        id: row.id,
        displayName: row.nameZhCn || row.nameEn || row.name || row.id,
        ...(row.nameEn ? { displayNameEn: row.nameEn } : {}),
        ...(row.iconPath ? { iconPath: row.iconPath } : {}),
        required,
        owned: currentOwned,
        remaining: required - currentOwned,
        maxStackSize: override ?? row.maxStackSize,
        status,
        ...(row.warnings?.length ? { warning: row.warnings.join("；") } : {}),
      };
    })
    .sort((a, b) => b.required - a.required || a.id.localeCompare(b.id));
}

function isModMaterialId(id: string) {
  const separator = id.indexOf(":");
  return separator > 0 && id.slice(0, separator) !== "minecraft";
}

function applyModResources(
  materials: StudioMaterial[],
  resources: Readonly<Record<string, ModMaterialResource>>,
): StudioMaterial[] {
  return materials.map((material) => {
    const resource = resources[material.id];
    if (!resource) return material;
    const loadedFields = resource.iconPath ? "名称和图标" : "名称";
    return {
      ...material,
      displayName: resource.displayName,
      displayNameEn: resource.displayNameEn,
      ...(resource.iconPath ? { iconPath: resource.iconPath } : {}),
      status: material.status === "用户设置" ? "用户设置" : "模组",
      warning:
        material.maxStackSize === null
          ? `已从 ${resource.sourceFile} 加载${loadedFields}；模组运行时堆叠上限仍需手动设置`
          : `已从 ${resource.sourceFile} 加载模组资源`,
    };
  });
}

export function App() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [project, setProject] = useState<StudioProject | null>(null);
  const [fileName, setFileName] = useState("");
  const [stage, setStage] = useState<ProcessingStage>("读取文件");
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const [sort, setSort] = useState<MaterialSort>("required-desc");
  const [toast, setToast] = useState<string | null>(null);
  const [lastProject, setLastProject] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(LAST_PROJECT_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [batchHistoryCount, setBatchHistoryCount] = useState(0);
  const [modResources, setModResources] = useState<Record<string, ModMaterialResource>>({});
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const batchHistory = useRef<StudioMaterial[][]>([]);

  useEffect(() => {
    if (!project) return;
    const timer = window.setTimeout(() => {
      const saved: SavedProgress = {
        schemaVersion: 1,
        fileName: project.fileName,
        owned: Object.fromEntries(
          project.materials.map((material) => [material.id, material.owned]),
        ),
        maxStackOverrides: Object.fromEntries(
          project.materials.flatMap((material) =>
            material.status === "用户设置" && material.maxStackSize !== null
              ? [[material.id, material.maxStackSize]]
              : [],
          ),
        ),
        savedAt: Date.now(),
      };
      try {
        localStorage.setItem(progressKey(project.projectId), JSON.stringify(saved));
        localStorage.setItem(LAST_PROJECT_KEY, project.metadata.name || project.fileName);
      } catch {
        // Storage can be unavailable in hardened or private browser modes; the current session still works.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      abortRef.current?.abort();
    },
    [],
  );

  const reset = () => {
    workerRef.current?.postMessage({ type: "cancel" });
    workerRef.current?.terminate();
    workerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    batchHistory.current = [];
    setBatchHistoryCount(0);
    setModResources({});
    setProject(null);
    setFileName("");
    setError(null);
    setQuery("");
    setFilter("all");
    setSort("required-desc");
    setProgress(0);
    setPhase("upload");
  };

  const finishWorkerResult = (
    response: Extract<WorkerResponse, { type: "result" }>,
    projectId: string,
    selectedFileName: string,
    selectedFileSize: number,
  ) => {
    const parsed = response.result as LitematicParseResult;
    const match = response.versionMatch as VersionMatchWire;
    const saved = loadSavedProgress(projectId);
    const rows = response.materials as MaterialWire[];

    const detectedVersion = match.originalDetectedVersion ?? match.minecraftVersion ?? null;
    const dataVersion = match.minecraftVersion ?? null;
    const warnings = [
      ...parsed.warnings.map((warning) => warning.message),
      ...(match.warnings ?? []),
      ...(detectedVersion ? [] : ["无法识别 Minecraft 版本；材料以原始方块 ID 保留。"]),
      ...(dataVersion ? [] : ["没有可自动匹配的本地物品数据；材料以原始方块 ID 保留。"]),
    ];
    setProject({
      projectId,
      fileName: selectedFileName,
      fileSize: selectedFileSize,
      metadata: metadataFromParsed(parsed),
      detectedVersion,
      dataVersion,
      matchType: match.matchType ?? match.type ?? "unknown",
      materials: normalizeMaterials(rows, saved?.owned, saved?.maxStackOverrides),
      warnings,
    });
    setProgress(100);
    setPhase("results");
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setPhase("processing");
    setStage("读取文件");
    setProgressDetail(
      file.size > 32 * 1024 * 1024
        ? "大型投影可能需要较多内存，请保持页面打开"
        : "读取本地文件，不会发送网络请求",
    );
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const buffer = await readFileAsArrayBuffer(
        file,
        (ratio) => setProgress(Math.max(1, Math.round(ratio * 14))),
        controller.signal,
      );
      const projectId = await fileHash(buffer);
      if (controller.signal.aborted) return;
      const worker = new Worker(new URL("./workers/litematic.worker.ts", import.meta.url), {
        type: "module",
        name: "litematic-parser",
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.type === "progress") {
          setStage(response.stage);
          setProgress(response.progress);
          setProgressDetail(response.detail);
        } else if (response.type === "error") {
          setError(response.stack ? `${response.message}（${response.stack}）` : response.message);
          reset();
          setError(response.message);
        } else {
          try {
            finishWorkerResult(response, projectId, file.name, file.size);
          } catch (reason) {
            reset();
            setError(reason instanceof Error ? reason.message : "生成材料清单失败");
          }
        }
      };
      worker.onerror = (event) => {
        setError(event.message || "解析 Worker 意外终止");
        reset();
        setError(event.message || "解析 Worker 意外终止");
      };
      worker.postMessage(
        { type: "parse", buffer, projectId, fileName: file.name, fileSize: file.size },
        [buffer],
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      reset();
      setError(reason instanceof Error ? reason.message : "读取文件失败");
    }
  };

  const changeQuantity = (
    id: string,
    field: "required" | "owned" | "remaining",
    rawValue: number,
  ) => {
    const value = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(rawValue)));
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        materials: current.materials.map((material) => {
          if (material.id !== id) return material;
          if (field === "required") {
            const owned = Math.min(material.owned, value);
            return { ...material, required: value, owned, remaining: value - owned };
          }
          if (field === "owned") {
            const owned = Math.min(material.required, value);
            return { ...material, owned, remaining: material.required - owned };
          }
          const remaining = Math.min(material.required, value);
          return { ...material, remaining, owned: material.required - remaining };
        }),
      };
    });
  };

  const batchUpdate = (mode: "reset" | "complete") => {
    setProject((current) => {
      if (!current) return current;
      batchHistory.current.push(current.materials.map((material) => ({ ...material })));
      if (batchHistory.current.length > 10) batchHistory.current.shift();
      setBatchHistoryCount(batchHistory.current.length);
      return {
        ...current,
        materials: current.materials.map((material) =>
          mode === "complete"
            ? { ...material, owned: material.required, remaining: 0 }
            : { ...material, owned: 0, remaining: material.required },
        ),
      };
    });
    setToast(mode === "complete" ? "已标记全部完成" : "已将全部已有数量清零");
  };

  const changeMaxStackSize = (id: string, value: number | null) => {
    setProject((current) =>
      current
        ? {
            ...current,
            materials: current.materials.map((material) =>
              material.id === id
                ? {
                    ...material,
                    maxStackSize: value,
                    status: value === null ? (modResources[id] ? "模组" : "未知") : "用户设置",
                  }
                : material,
            ),
          }
        : current,
    );
  };

  const undoBatch = () => {
    const previous = batchHistory.current.pop();
    if (!previous) return;
    setProject((current) => (current ? { ...current, materials: previous } : current));
    setBatchHistoryCount(batchHistory.current.length);
    setToast("已撤销最近一次批量操作");
  };

  const exportExcel = async () => {
    if (!project) return;
    try {
      const { downloadMaterialWorkbook } = await import("./lib/excel");
      await downloadMaterialWorkbook({
        metadata: {
          name: project.metadata.name,
          author: project.metadata.author,
          description: project.metadata.description,
          createdAt: project.metadata.timeCreated,
          modifiedAt: project.metadata.timeModified,
          originalFileName: project.fileName,
          fileSizeBytes: project.fileSize,
          dimensions: project.metadata.enclosingSize,
          regionCount: project.metadata.regionCount,
          dataVersion: project.metadata.minecraftDataVersion,
          detectedMinecraftVersion: project.detectedVersion,
          versionMatchType: project.matchType,
          litematicFormatVersion: project.metadata.formatVersion,
          litematicSubVersion: project.metadata.subVersion,
          totalVolume: project.metadata.totalVolume,
          nonAirBlockCount: project.metadata.totalBlocks,
          materialCount: project.materials.length,
          unknownItemCount: project.materials.filter(
            (material) => material.status === "未知" || material.status === "模组",
          ).length,
          warnings: project.warnings,
        },
        minecraftVersion: project.dataVersion ?? project.detectedVersion ?? "未知",
        materials: project.materials.map((material) => ({
          itemName: material.displayName,
          minecraftId: material.id,
          totalRequired: material.required,
          owned: material.owned,
          maxStackSize: material.maxStackSize,
          ...(material.warning ? { note: material.warning } : {}),
          unknownOrMod: material.status === "未知" || material.status === "模组",
        })),
        toolVersion: "1.0.0",
      });
      setToast("Excel 已在浏览器本地生成");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "Excel 生成失败");
    }
  };

  const clearSavedProgress = () => {
    if (!project) return;
    try {
      localStorage.removeItem(progressKey(project.projectId));
    } catch {
      /* ignored */
    }
    setProject((current) =>
      current
        ? {
            ...current,
            materials: current.materials.map((material) => ({
              ...material,
              owned: 0,
              remaining: material.required,
            })),
          }
        : current,
    );
    setToast("已清除这个投影的本地进度");
  };

  const filteredMaterials = useMemo(() => {
    if (!project) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const values = project.materials.filter((material) => {
      if (
        normalizedQuery &&
        !`${material.displayName} ${material.displayNameEn ?? ""} ${material.id}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
        return false;
      if (filter === "incomplete" && material.remaining === 0) return false;
      if (filter === "complete" && material.remaining !== 0) return false;
      if (filter === "unknown" && material.status !== "未知" && material.status !== "模组")
        return false;
      return true;
    });
    return [...values].sort((a, b) => {
      if (sort === "required-desc") return b.required - a.required;
      if (sort === "remaining-desc") return b.remaining - a.remaining;
      if (sort === "completion-asc") {
        const ap = a.required === 0 ? 1 : a.owned / a.required;
        const bp = b.required === 0 ? 1 : b.owned / b.required;
        return ap - bp;
      }
      return a.displayName.localeCompare(b.displayName, "zh-CN");
    });
  }, [filter, project, query, sort]);

  const modMaterialIds = useMemo(
    () =>
      project?.materials.filter((material) => isModMaterialId(material.id)).map(({ id }) => id) ??
      [],
    [project],
  );

  const handleModResourcesImported = (result: ModResourceImportResult) => {
    setModResources((current) => ({ ...current, ...result.resources }));
    setProject((current) =>
      current
        ? { ...current, materials: applyModResources(current.materials, result.resources) }
        : current,
    );
    setToast(
      result.matchedItemCount
        ? `已加载 ${result.matchedItemCount} 个模组物品资源`
        : "所选文件没有匹配当前材料中的模组物品",
    );
  };

  return (
    <div className="app-shell" id="top">
      <header className="app-header">
        <Brand />
        <div className="header-meta">
          <i />
          <span>Local-only processing</span>
        </div>
      </header>

      {phase === "upload" ? (
        <UploadPanel
          onFile={(file) => void handleFile(file)}
          restoredProjectName={lastProject}
          onDismissRestore={() => setLastProject(undefined)}
          externalError={error}
        />
      ) : null}

      {phase === "processing" ? (
        <ProcessingPanel
          fileName={fileName}
          stage={stage}
          progress={progress}
          detail={progressDetail}
          onCancel={reset}
        />
      ) : null}

      {phase === "results" && project ? (
        <main className="results-page" id="main-content">
          <SchematicHeader project={project} />
          {project.warnings.length ? (
            <details className="warning-panel">
              <summary>{project.warnings.length} 条解析或兼容性提示</summary>
              <ul>
                {project.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <section className="results-actions" aria-label="项目操作">
            <button className="action-button" type="button" onClick={clearSavedProgress}>
              清除本地进度
            </button>
            <button
              className="action-button action-button--primary"
              type="button"
              onClick={() => void exportExcel()}
            >
              导出 Excel
            </button>
            <button className="action-button action-button--danger" type="button" onClick={reset}>
              重置项目
            </button>
          </section>
          {modMaterialIds.length ? (
            <ModResourceImporter
              key={project.projectId}
              targetIds={modMaterialIds}
              onImported={handleModResourcesImported}
            />
          ) : null}
          <MaterialToolbar
            query={query}
            filter={filter}
            sort={sort}
            count={filteredMaterials.length}
            canUndo={batchHistoryCount > 0}
            onQuery={setQuery}
            onFilter={setFilter}
            onSort={setSort}
            onResetOwned={() => batchUpdate("reset")}
            onCompleteAll={() => batchUpdate("complete")}
            onUndo={undoBatch}
          />
          <MaterialTable
            materials={filteredMaterials}
            onQuantityChange={changeQuantity}
            onMaxStackSizeChange={changeMaxStackSize}
          />
        </main>
      ) : null}
      <footer className="app-disclaimer">
        非官方 Minecraft 工具，不受 Mojang 或 Microsoft 批准、支持或关联。物品图标取自
        <a href="https://minecraft.wiki/" target="_blank" rel="noreferrer">
          Minecraft Wiki
        </a>
        ，相关游戏素材权利归其权利人所有。
      </footer>
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
