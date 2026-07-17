/// <reference lib="webworker" />

import { parseLitematic } from "../lib/litematic";
import { detectMinecraftVersion, loadMinecraftVersionData } from "../lib/minecraft-data";
import { convertBlockStateCounts } from "../lib/materials";
import { toFriendlyError } from "../lib/errors/friendly-error";
import type { ProcessingStage } from "../app/types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const context = self as DedicatedWorkerGlobalScope;
let cancelled = false;

function progress(stage: ProcessingStage, value: number, detail?: string) {
  const response: WorkerResponse = {
    type: "progress",
    stage,
    progress: value,
    ...(detail ? { detail } : {}),
  };
  context.postMessage(response);
}

function ensureActive() {
  if (cancelled) throw new DOMException("解析已取消", "AbortError");
}

context.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "cancel") {
    cancelled = true;
    return;
  }

  cancelled = false;
  void runParse(event.data);
};

async function runParse(request: Extract<WorkerRequest, { type: "parse" }>) {
  try {
    progress("解压 gzip", 18, "校验压缩数据");
    ensureActive();
    await Promise.resolve();

    progress("解析 NBT", 30, "读取投影元数据与 Region");
    const result = parseLitematic(new Uint8Array(request.buffer), { fileName: request.fileName });
    ensureActive();

    progress("识别版本", 49, "匹配 Minecraft DataVersion");
    const versionMatch = detectMinecraftVersion(result.metadata.minecraftDataVersion, {
      formatVersion: result.metadata.formatVersion,
      subVersion: result.metadata.subVersion,
    });
    ensureActive();

    let versionData: Awaited<ReturnType<typeof loadMinecraftVersionData>> | null = null;
    if (versionMatch.minecraftVersion) {
      progress("加载物品数据", 61, `Minecraft Java ${versionMatch.minecraftVersion}`);
      versionData = await loadMinecraftVersionData(versionMatch.minecraftVersion);
      ensureActive();
    }

    progress("解码方块状态", 74, `${result.blockStateCounts.length} 种方块状态`);
    ensureActive();

    progress("统计材料", 87, "应用方块到物品转换规则");
    const materials = versionData
      ? convertBlockStateCounts(result.blockStateCounts, versionData)
      : result.blockStateCounts
          .filter((entry) => !/^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(entry.name))
          .map((entry) => ({
            id: entry.name.includes(":") ? entry.name : `minecraft:${entry.name}`,
            name: entry.name,
            nameZhCn: undefined,
            nameEn: undefined,
            maxStackSize: null,
            status: "unknown" as const,
            required: entry.count,
            warnings: ["无法识别投影版本，已保留原始方块状态"],
            sourceBlockIds: [entry.name],
          }));
    ensureActive();

    progress("生成结果", 97, "恢复本地进度并整理清单");
    const response: WorkerResponse = {
      type: "result",
      result,
      versionMatch,
      versionData,
      materials,
    };
    context.postMessage(response);
  } catch (error) {
    if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
    const friendly = toFriendlyError(error);
    const response: WorkerResponse = {
      type: "error",
      message: friendly.message,
      ...(friendly.detail ? { stack: friendly.detail } : {}),
    };
    context.postMessage(response);
  }
}

export {};
