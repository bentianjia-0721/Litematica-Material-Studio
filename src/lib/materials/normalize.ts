import { normalizeMinecraftId } from "../minecraft-data";
import type {
  BlockStateCountLike,
  BlockStateCountsInput,
  NormalizedBlockStateCount,
} from "./types";

const KEY_PATTERN = /^(?<name>[^\[]+?)(?:\[(?<properties>.*)\])?$/u;

function normalizeProperties(
  properties: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (!properties) return {};
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key.trim().toLowerCase(), String(value)]),
  );
}

export function parseBlockStateKey(key: string): {
  name: string;
  properties: Readonly<Record<string, string>>;
} {
  const match = KEY_PATTERN.exec(key.trim());
  const rawName = match?.groups?.name?.trim() || key.trim();
  const rawProperties = match?.groups?.properties;
  const properties: Record<string, string> = {};
  if (rawProperties) {
    for (const pair of rawProperties.split(",")) {
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      properties[pair.slice(0, separator).trim().toLowerCase()] = pair.slice(separator + 1).trim();
    }
  }
  return { name: normalizeMinecraftId(rawName), properties };
}

function normalizeCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count));
}

function normalizeEntry(entry: BlockStateCountLike): NormalizedBlockStateCount {
  const parsed = entry.key ? parseBlockStateKey(entry.key) : undefined;
  const name = normalizeMinecraftId(entry.name || parsed?.name || "minecraft:air");
  const properties = normalizeProperties(
    entry.properties && Object.keys(entry.properties).length
      ? entry.properties
      : parsed?.properties,
  );
  const propertyKey = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return {
    key: propertyKey ? `${name}[${propertyKey}]` : name,
    name,
    properties,
    count: normalizeCount(entry.count),
  };
}

export function normalizeBlockStateCounts(
  input: BlockStateCountsInput,
): NormalizedBlockStateCount[] {
  if (Array.isArray(input)) {
    return input.map(normalizeEntry).filter((entry) => entry.count > 0);
  }
  let entries: Array<[string, number]>;
  if (input instanceof Map) {
    entries = [...(input as ReadonlyMap<string, number>).entries()];
  } else {
    const record = input as Readonly<Record<string, number>>;
    entries = Object.keys(record).map((key) => [key, record[key] ?? 0]);
  }
  return entries
    .map(([key, count]) => {
      const parsed = parseBlockStateKey(key);
      return normalizeEntry({ key, name: parsed.name, properties: parsed.properties, count });
    })
    .filter((entry) => entry.count > 0);
}
