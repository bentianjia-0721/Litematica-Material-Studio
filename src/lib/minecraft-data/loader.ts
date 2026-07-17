import versionsFile from "../../data/minecraft/versions.json";
import type { MinecraftVersionData, MinecraftVersionSummary } from "./types";

type JsonModule = { default: unknown };

const versionModules = import.meta.glob<JsonModule>("../../data/minecraft/java/*.json");
const cache = new Map<string, Promise<MinecraftVersionData>>();

const summaries = (versionsFile as { versions: MinecraftVersionSummary[] }).versions;
const summariesByVersion = new Map(summaries.map((entry) => [entry.version, entry]));

export class MinecraftVersionDataError extends Error {
  readonly requestedVersion: string;
  readonly availableVersions: string[];

  constructor(message: string, requestedVersion: string) {
    super(message);
    this.name = "MinecraftVersionDataError";
    this.requestedVersion = requestedVersion;
    this.availableVersions = listMinecraftVersions().map((entry) => entry.version);
  }
}

function unwrapModule(module: JsonModule): unknown {
  return module.default;
}

function validateVersionData(value: unknown, requestedVersion: string): MinecraftVersionData {
  if (!value || typeof value !== "object") {
    throw new MinecraftVersionDataError("Version data is not an object", requestedVersion);
  }
  const data = value as Partial<MinecraftVersionData>;
  if (
    data.schemaVersion !== 1 ||
    data.minecraftVersion !== requestedVersion ||
    !data.items ||
    !data.blocks ||
    !data.blockToItem
  ) {
    throw new MinecraftVersionDataError(
      `Version data for ${requestedVersion} has an invalid or mismatched schema`,
      requestedVersion,
    );
  }
  return {
    ...data,
    version: data.version ?? data.minecraftVersion,
  } as MinecraftVersionData;
}

export function listMinecraftVersions(): readonly MinecraftVersionSummary[] {
  return summaries;
}

export function hasMinecraftVersionData(version: string): boolean {
  return summariesByVersion.has(version);
}

export function getMinecraftVersionSummary(version: string): MinecraftVersionSummary | undefined {
  return summariesByVersion.get(version);
}

export async function loadMinecraftVersionData(version: string): Promise<MinecraftVersionData> {
  const normalizedVersion = version.trim();
  if (!summariesByVersion.has(normalizedVersion)) {
    throw new MinecraftVersionDataError(
      `No generated Minecraft item data is available for ${normalizedVersion}; a newer version is not used implicitly`,
      normalizedVersion,
    );
  }
  const existing = cache.get(normalizedVersion);
  if (existing) return existing;

  const expectedSuffix = `/java/${normalizedVersion}.json`;
  const moduleEntry = Object.entries(versionModules).find(([fileName]) =>
    fileName.replaceAll("\\", "/").endsWith(expectedSuffix),
  );
  if (!moduleEntry) {
    throw new MinecraftVersionDataError(
      `The index references ${normalizedVersion}, but its JSON chunk is missing`,
      normalizedVersion,
    );
  }

  const promise = moduleEntry[1]()
    .then(unwrapModule)
    .then((data) => validateVersionData(data, normalizedVersion));
  cache.set(normalizedVersion, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(normalizedVersion);
    throw error;
  }
}

export function clearMinecraftVersionDataCache(): void {
  cache.clear();
}
