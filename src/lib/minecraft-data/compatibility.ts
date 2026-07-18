import dataVersionFile from "../../data/minecraft/data-version-map.json";
import compatibilityFile from "../../data/minecraft/litematica-compatibility.json";
import { hasMinecraftVersionData, listMinecraftVersions } from "./loader";
import type {
  DataVersionEntry,
  LitematicaCompatibilityEntry,
  VersionCandidate,
  VersionDetectionOptions,
  VersionMatch,
  VersionMatchType,
} from "./types";

const dataVersionEntries = (dataVersionFile as { entries: DataVersionEntry[] }).entries;
const compatibilityEntries = (compatibilityFile as { entries: LitematicaCompatibilityEntry[] })
  .entries;
const summaries = listMinecraftVersions();

function candidateFor(version: string, reason: string): VersionCandidate {
  const summary = summaries.find((entry) => entry.version === version);
  return {
    version,
    dataVersion: summary?.dataVersion ?? null,
    supportStatus: summary?.supportStatus ?? "unverified",
    reason,
  };
}

function buildMatch(
  originalDataVersion: number | null,
  originalDetectedVersion: string | null,
  selectedVersion: string | null,
  matchType: VersionMatchType,
  confidence: VersionMatch["confidence"],
  candidates: VersionCandidate[],
  warnings: string[],
  options: VersionDetectionOptions,
): VersionMatch {
  return {
    originalDataVersion,
    originalDetectedVersion,
    selectedVersion,
    version: selectedVersion,
    minecraftVersion: selectedVersion,
    matchType,
    type: matchType,
    confidence,
    candidates,
    warnings,
    detectionHints: {
      formatVersion: options.formatVersion ?? null,
      subVersion: options.subVersion ?? null,
      metadataVersion: options.metadataVersion ?? null,
    },
  };
}

function formatCandidates(formatVersion: number | null | undefined): VersionCandidate[] {
  if (formatVersion === null || formatVersion === undefined) return [];
  const versions = new Set(
    compatibilityEntries
      .filter((entry) => entry.litematicFormatVersion === formatVersion)
      .filter((entry) => hasMinecraftVersionData(entry.minecraftVersion))
      .map((entry) => entry.minecraftVersion),
  );
  return [...versions]
    .map((version) => candidateFor(version, `Litematic 格式版本 ${formatVersion} 的候选版本`))
    .slice(0, 12);
}

function nearestReleaseEntry(dataVersion: number): DataVersionEntry | undefined {
  return dataVersionEntries
    .filter((entry) => entry.releaseType === "release")
    .reduce<DataVersionEntry | undefined>((best, current) => {
      if (!best) return current;
      return Math.abs(current.dataVersion - dataVersion) < Math.abs(best.dataVersion - dataVersion)
        ? current
        : best;
    }, undefined);
}

function nearestLocalVersionInSeries(target: DataVersionEntry) {
  return summaries
    .map((summary) => ({
      summary,
      map: dataVersionEntries.find(
        (entry) => entry.minecraftVersion === summary.version && entry.releaseType === "release",
      ),
    }))
    .filter(
      (entry): entry is { summary: (typeof summaries)[number]; map: DataVersionEntry } =>
        Boolean(entry.map) && entry.map?.majorVersion === target.majorVersion,
    )
    .sort(
      (left, right) =>
        Math.abs(left.map.dataVersion - target.dataVersion) -
        Math.abs(right.map.dataVersion - target.dataVersion),
    )[0];
}

export function detectMinecraftVersion(
  dataVersion: number | null | undefined,
  options: VersionDetectionOptions = {},
): VersionMatch {
  const normalizedDataVersion =
    typeof dataVersion === "number" && Number.isSafeInteger(dataVersion) ? dataVersion : null;

  if (normalizedDataVersion !== null) {
    const exactEntries = dataVersionEntries.filter(
      (entry) => entry.dataVersion === normalizedDataVersion,
    );
    if (exactEntries.length) {
      const exact =
        exactEntries.find(
          (entry) =>
            entry.releaseType === "release" && hasMinecraftVersionData(entry.minecraftVersion),
        ) ??
        exactEntries.find((entry) => entry.releaseType === "release") ??
        exactEntries[0];
      if (!exact) throw new Error("Unreachable empty exact DataVersion result");
      const available = hasMinecraftVersionData(exact.minecraftVersion);
      const compatible = available ? undefined : nearestLocalVersionInSeries(exact);
      if (compatible) {
        const dataVersion = compatible.summary.version;
        return buildMatch(
          normalizedDataVersion,
          exact.minecraftVersion,
          dataVersion,
          "compatible",
          "inferred",
          [
            candidateFor(exact.minecraftVersion, "DataVersion 精确识别的投影版本"),
            candidateFor(dataVersion, `同一 ${exact.majorVersion} 系列的最近本地物品数据`),
          ],
          [
            `已自动识别 Minecraft ${exact.minecraftVersion}；本地没有该补丁版本的精确物品数据，自动使用同系列 ${dataVersion} 数据`,
          ],
          options,
        );
      }
      return buildMatch(
        normalizedDataVersion,
        exact.minecraftVersion,
        available ? exact.minecraftVersion : null,
        "exact",
        "verified",
        exactEntries
          .map((entry) => candidateFor(entry.minecraftVersion, "DataVersion 精确匹配"))
          .slice(0, 12),
        available ? [] : [`已识别 ${exact.minecraftVersion}，但该版本没有本地物品数据`],
        options,
      );
    }

    const nearest = nearestReleaseEntry(normalizedDataVersion);
    const maxDistance = Math.max(0, options.compatibleDistance ?? 64);
    if (nearest && Math.abs(nearest.dataVersion - normalizedDataVersion) <= maxDistance) {
      const localSameMajor = nearestLocalVersionInSeries({
        ...nearest,
        dataVersion: normalizedDataVersion,
      });
      if (localSameMajor) {
        const version = localSameMajor.summary.version;
        return buildMatch(
          normalizedDataVersion,
          nearest.minecraftVersion,
          version,
          "compatible",
          "inferred",
          [candidateFor(version, `同一 ${nearest.majorVersion} 数据系列的最近本地版本`)],
          [
            `DataVersion ${normalizedDataVersion} 没有精确记录，当前使用兼容候选 ${version}；转换结果需要复核`,
          ],
          options,
        );
      }
    }
  }

  const metadataVersion = options.metadataVersion?.trim();
  if (metadataVersion && hasMinecraftVersionData(metadataVersion)) {
    return buildMatch(
      normalizedDataVersion,
      metadataVersion,
      metadataVersion,
      "inferred",
      "cross-checked",
      [candidateFor(metadataVersion, "Metadata 中的 Minecraft 版本")],
      ["缺少可精确匹配的 DataVersion，使用 Metadata 版本"],
      options,
    );
  }
  if (metadataVersion) {
    const metadataEntry = dataVersionEntries.find(
      (entry) => entry.minecraftVersion === metadataVersion && entry.releaseType === "release",
    );
    const compatible = metadataEntry ? nearestLocalVersionInSeries(metadataEntry) : undefined;
    if (metadataEntry && compatible) {
      return buildMatch(
        normalizedDataVersion,
        metadataVersion,
        compatible.summary.version,
        "compatible",
        "inferred",
        [candidateFor(compatible.summary.version, "Metadata 版本的同系列本地物品数据")],
        [
          `已从 Metadata 自动识别 Minecraft ${metadataVersion}；自动使用同系列 ${compatible.summary.version} 数据`,
        ],
        options,
      );
    }
  }

  const fromFormat = formatCandidates(options.formatVersion);
  const generalCandidates = fromFormat.length
    ? fromFormat
    : summaries
        .slice(-8)
        .map((entry) => candidateFor(entry.version, "可用于自动兼容判断的本地数据版本"));
  return buildMatch(
    normalizedDataVersion,
    null,
    null,
    "unknown",
    "unknown",
    generalCandidates,
    [
      normalizedDataVersion === null
        ? "文件未提供可用的 DataVersion；不会自动套用最新版本"
        : `未知 DataVersion ${normalizedDataVersion}；不会自动套用最新版本`,
    ],
    options,
  );
}

export function getLitematicaCompatibilityEntries(): readonly LitematicaCompatibilityEntry[] {
  return compatibilityEntries;
}
