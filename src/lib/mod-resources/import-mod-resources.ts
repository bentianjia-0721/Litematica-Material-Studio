import JSZip, { type JSZipObject } from "jszip";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_TEXT_LENGTH = 4 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 8 * 1024 * 1024;
const MODEL_DEPTH_LIMIT = 12;

export interface ModMaterialResource {
  id: string;
  displayName: string;
  displayNameEn: string;
  iconPath?: string;
  sourceFile: string;
  namespace: string;
}

export interface ModResourceImportResult {
  resources: Record<string, ModMaterialResource>;
  archiveCount: number;
  matchedItemCount: number;
  warnings: string[];
}

interface ModelJson {
  parent?: string;
  textures?: Record<string, string>;
}

function splitId(id: string): { namespace: string; path: string } | null {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator >= id.length - 1) return null;
  return {
    namespace: id.slice(0, separator).toLowerCase(),
    path: id.slice(separator + 1).toLowerCase(),
  };
}

function humanizePath(value: string): string {
  return value
    .split(/[\/_-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function archiveNamespaces(zip: JSZip): Set<string> {
  const namespaces = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    const match = /^assets\/([^/]+)\//u.exec(name.toLowerCase());
    if (match?.[1]) namespaces.add(match[1]);
  }
  return namespaces;
}

async function readText(
  entry: JSZipObject | null | undefined,
  label: string,
): Promise<string | null> {
  if (!entry || entry.dir) return null;
  const text = await entry.async("string");
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`${label} 解压后超过 4 MiB`);
  return text;
}

async function readJson<T>(
  entry: JSZipObject | null | undefined,
  label: string,
): Promise<T | null> {
  const text = await readText(entry, label);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function normalizeResourceReference(
  reference: string,
  fallbackNamespace: string,
): { namespace: string; path: string } {
  const separator = reference.indexOf(":");
  return separator > 0
    ? {
        namespace: reference.slice(0, separator).toLowerCase(),
        path: reference
          .slice(separator + 1)
          .replace(/^models\//u, "")
          .toLowerCase(),
      }
    : { namespace: fallbackNamespace, path: reference.replace(/^models\//u, "").toLowerCase() };
}

async function loadModelTextures(
  zip: JSZip,
  reference: string,
  fallbackNamespace: string,
  cache: Map<string, Record<string, string>>,
  seen = new Set<string>(),
): Promise<Record<string, string>> {
  const normalized = normalizeResourceReference(reference, fallbackNamespace);
  const cacheKey = `${normalized.namespace}:${normalized.path}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? {};
  if (seen.size >= MODEL_DEPTH_LIMIT || seen.has(cacheKey)) return {};
  seen.add(cacheKey);
  const modelPath = `assets/${normalized.namespace}/models/${normalized.path}.json`;
  const model = await readJson<ModelJson>(zip.file(modelPath), modelPath);
  if (!model) return {};
  const inherited = model.parent
    ? await loadModelTextures(zip, model.parent, normalized.namespace, cache, seen)
    : {};
  const textures = { ...inherited, ...(model.textures ?? {}) };
  cache.set(cacheKey, textures);
  return textures;
}

function findItemDefinitionModel(value: unknown, depth = 0): string | null {
  if (depth > 12 || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.model === "string") return record.model;
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        const found = findItemDefinitionModel(entry, depth + 1);
        if (found) return found;
      }
    } else {
      const found = findItemDefinitionModel(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function resolveTextureAlias(value: string, textures: Record<string, string>): string | null {
  let resolved = value;
  const seen = new Set<string>();
  while (resolved.startsWith("#")) {
    const key = resolved.slice(1);
    if (seen.has(key)) return null;
    seen.add(key);
    const next = textures[key];
    if (!next) return null;
    resolved = next;
  }
  return resolved;
}

function textureEntryFromReference(
  zip: JSZip,
  reference: string,
  fallbackNamespace: string,
): JSZipObject | null {
  const normalized = normalizeResourceReference(reference, fallbackNamespace);
  const texturePath = normalized.path.replace(/^textures\//u, "");
  return zip.file(`assets/${normalized.namespace}/textures/${texturePath}.png`);
}

async function resolveIconEntry(
  zip: JSZip,
  namespace: string,
  itemPath: string,
  modelCache: Map<string, Record<string, string>>,
): Promise<JSZipObject | null> {
  const definitionPath = `assets/${namespace}/items/${itemPath}.json`;
  const definition = await readJson<unknown>(zip.file(definitionPath), definitionPath);
  const definitionModel = findItemDefinitionModel(definition);
  const modelReferences = [
    ...(definitionModel ? [definitionModel] : []),
    `${namespace}:item/${itemPath}`,
    `${namespace}:block/${itemPath}`,
  ];
  const texturePreference = [
    "layer0",
    "all",
    "particle",
    "top",
    "side",
    "end",
    "bottom",
    "texture",
  ];
  for (const modelReference of modelReferences) {
    const textures = await loadModelTextures(zip, modelReference, namespace, modelCache, new Set());
    const keys = [...texturePreference, ...Object.keys(textures)];
    for (const key of keys) {
      const value = textures[key];
      if (!value) continue;
      const resolved = resolveTextureAlias(value, textures);
      if (!resolved) continue;
      const entry = textureEntryFromReference(zip, resolved, namespace);
      if (entry) return entry;
    }
  }
  const directCandidates = [
    `assets/${namespace}/textures/item/${itemPath}.png`,
    `assets/${namespace}/textures/items/${itemPath}.png`,
    `assets/${namespace}/textures/block/${itemPath}.png`,
    `assets/${namespace}/textures/blocks/${itemPath}.png`,
  ];
  for (const path of directCandidates) {
    const entry = zip.file(path);
    if (entry) return entry;
  }
  return null;
}

function bytesToDataUrl(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_TEXTURE_BYTES) throw new Error("单个模组图标解压后超过 8 MiB");
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function loadLanguage(
  zip: JSZip,
  namespace: string,
  locale: "zh_cn" | "en_us",
): Promise<Record<string, string>> {
  const path = `assets/${namespace}/lang/${locale}.json`;
  return (await readJson<Record<string, string>>(zip.file(path), path)) ?? {};
}

export async function importModResources(
  files: File[],
  targetIds: string[],
): Promise<ModResourceImportResult> {
  const targets = [...new Set(targetIds)]
    .map((id) => ({ id, parsed: splitId(id) }))
    .filter((entry): entry is { id: string; parsed: { namespace: string; path: string } } =>
      Boolean(entry.parsed && entry.parsed.namespace !== "minecraft"),
    );
  const resources: Record<string, ModMaterialResource> = {};
  const warnings: string[] = [];
  const foundNamespaces = new Set<string>();
  let archiveCount = 0;

  for (const file of files) {
    if (!/\.(?:jar|zip)$/iu.test(file.name)) {
      warnings.push(`${file.name}：只支持 .jar 或 .zip`);
      continue;
    }
    if (file.size > MAX_ARCHIVE_BYTES) {
      warnings.push(`${file.name}：文件超过 256 MiB`);
      continue;
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file, { createFolders: false });
    } catch {
      warnings.push(`${file.name}：不是可读取的 ZIP/JAR`);
      continue;
    }
    if (Object.keys(zip.files).length > MAX_ARCHIVE_ENTRIES) {
      warnings.push(`${file.name}：压缩包条目超过 100,000`);
      continue;
    }
    archiveCount += 1;
    const namespaces = archiveNamespaces(zip);
    const modelCache = new Map<string, Record<string, string>>();
    for (const namespace of namespaces) foundNamespaces.add(namespace);

    for (const namespace of namespaces) {
      const namespaceTargets = targets.filter((entry) => entry.parsed.namespace === namespace);
      if (!namespaceTargets.length) continue;
      try {
        const [zhCn, enUs] = await Promise.all([
          loadLanguage(zip, namespace, "zh_cn"),
          loadLanguage(zip, namespace, "en_us"),
        ]);
        for (const target of namespaceTargets) {
          const itemKey = `item.${namespace}.${target.parsed.path}`;
          const blockKey = `block.${namespace}.${target.parsed.path}`;
          const displayNameEn = enUs[itemKey] ?? enUs[blockKey] ?? humanizePath(target.parsed.path);
          const displayName = zhCn[itemKey] ?? zhCn[blockKey] ?? displayNameEn;
          const iconEntry = await resolveIconEntry(zip, namespace, target.parsed.path, modelCache);
          const iconPath = iconEntry
            ? bytesToDataUrl(await iconEntry.async("uint8array"))
            : undefined;
          resources[target.id] = {
            id: target.id,
            displayName,
            displayNameEn,
            ...(iconPath ? { iconPath } : {}),
            sourceFile: file.name,
            namespace,
          };
        }
      } catch (error) {
        warnings.push(
          `${file.name} (${namespace})：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  for (const namespace of new Set(targets.map((entry) => entry.parsed.namespace))) {
    if (!foundNamespaces.has(namespace))
      warnings.push(`未在所选文件中找到 ${namespace} 资源命名空间`);
  }
  return {
    resources,
    archiveCount,
    matchedItemCount: Object.keys(resources).length,
    warnings,
  };
}
