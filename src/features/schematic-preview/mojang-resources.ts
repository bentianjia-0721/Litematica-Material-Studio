import { BlobReader, HttpRangeReader, HttpReader, ZipReader, type Entry } from "@zip.js/zip.js";
import { AssetsParser } from "mc-assets/dist/assetsParser.js";
import type { BlockModelsStore, BlockStatesStore } from "mc-assets/dist/stores.js";
import type { BlockModel, BlockStates, ResolvedBlockModel } from "mc-assets/dist/types.js";
import type { BlockState } from "../../lib/litematic";

export const MOJANG_VERSION_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_ATLAS_SIZE = 4096;
const ATLAS_PADDING = 1;

type JsonRecord = Record<string, unknown>;
type AtlasCanvas = HTMLCanvasElement | OffscreenCanvas;

export type MojangResourceIssueCode =
  | "UNSUPPORTED_NAMESPACE"
  | "BLOCKSTATE_MISSING"
  | "BLOCKSTATE_INVALID"
  | "MODEL_MISSING"
  | "MODEL_INVALID"
  | "MODEL_UNRESOLVED"
  | "TEXTURE_MISSING"
  | "TEXTURE_INVALID";

export interface MojangResourceIssue {
  readonly code: MojangResourceIssueCode;
  readonly message: string;
  readonly resource: string | null;
  readonly stateKey: string | null;
}

export type MojangResourceErrorCode =
  | "ABORTED"
  | "NETWORK_ERROR"
  | "INVALID_MANIFEST"
  | "VERSION_NOT_FOUND"
  | "INVALID_VERSION_METADATA"
  | "CLIENT_DOWNLOAD_MISSING"
  | "ARCHIVE_OPEN_FAILED"
  | "CANVAS_UNAVAILABLE";

export class MojangResourceError extends Error {
  readonly code: MojangResourceErrorCode;

  constructor(code: MojangResourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MojangResourceError";
    this.code = code;
  }
}

export interface MojangArchive {
  has(path: string): boolean;
  readText(path: string, signal?: AbortSignal): Promise<string>;
  readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface DecodedPng {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export interface MojangResourceDependencies {
  fetchJson(url: string, signal?: AbortSignal): Promise<unknown>;
  openArchive(url: string, signal?: AbortSignal): Promise<MojangArchive>;
  decodePng(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedPng>;
  createCanvas(width: number, height: number): AtlasCanvas;
}

export interface AtlasTextureRegion {
  /** Normalized resource path, for example `block/oak_planks`. */
  readonly texture: string;
  readonly atlasIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface MojangTextureAtlas {
  /** Can be passed to Three.js CanvasTexture or converted with createImageBitmap. */
  readonly canvas: AtlasCanvas;
  readonly width: number;
  readonly height: number;
}

export interface MojangResolvedResources {
  readonly version: string;
  readonly clientUrl: string;
  readonly clientSha1: string;
  /** Keyed by the original BlockState.key. Only fully renderable states are present. */
  readonly resolvedModels: ReadonlyMap<string, readonly ResolvedBlockModel[]>;
  /** Keyed by normalized texture path, such as `block/stone`. */
  readonly textureLookup: ReadonlyMap<string, AtlasTextureRegion>;
  readonly atlases: readonly MojangTextureAtlas[];
  /** Modded, missing, malformed, or otherwise non-renderable states. */
  readonly fallbackStates: readonly BlockState[];
  readonly issues: readonly MojangResourceIssue[];
}

export interface LoadMojangResourcesOptions {
  /** Auto-detected Minecraft version text, e.g. `1.21.5` or `Minecraft 1.21.5`. */
  readonly version: string;
  readonly states: readonly BlockState[];
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly maxAtlasSize?: number;
  readonly dependencies?: Partial<MojangResourceDependencies>;
}

interface VersionManifestEntry {
  readonly id: string;
  readonly url: string;
}

interface ClientDownload {
  readonly url: string;
  readonly sha1: string;
}

interface AnimationFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface LoadedTexture {
  readonly texture: string;
  readonly decoded: DecodedPng;
  readonly frame: AnimationFrameRect;
}

interface PendingPlacement extends LoadedTexture {
  atlasIndex: number;
  x: number;
  y: number;
}

interface AtlasSheet {
  readonly placements: PendingPlacement[];
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  usedWidth: number;
  usedHeight: number;
}

class RawMapStore<T> {
  constructor(
    private readonly values: ReadonlyMap<string, T>,
    private readonly normalizeKey: (key: string) => string | null,
  ) {}

  get(_version: string, key: string): T | undefined {
    const normalized = this.normalizeKey(key);
    if (normalized === null) return undefined;
    const value = this.values.get(normalized);
    return value === undefined ? undefined : structuredClone(value);
  }
}

class IndexedZipArchive implements MojangArchive {
  private readonly entries: ReadonlyMap<string, Entry>;

  constructor(
    private readonly reader: ZipReader<unknown>,
    entries: readonly Entry[],
  ) {
    this.entries = new Map(
      entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry]),
    );
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  async readText(path: string, signal?: AbortSignal): Promise<string> {
    const bytes = await this.readBytes(path, signal);
    return new TextDecoder().decode(bytes);
  }

  async readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);
    const entry = this.entries.get(path);
    if (!entry || entry.directory) {
      throw new Error(`Minecraft client resource is missing: ${path}`);
    }
    const data = await entry.arrayBuffer(signal === undefined ? undefined : { signal });
    throwIfAborted(signal);
    return new Uint8Array(data);
  }

  async close(): Promise<void> {
    await this.reader.close();
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new MojangResourceError("ABORTED", "Minecraft resource loading was cancelled.");
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
    throw new RangeError("Minecraft resource concurrency must be an integer from 1 to 32.");
  }
  return limit;
}

function normalizedAtlasSize(size: number | undefined): number {
  if (size === undefined) return DEFAULT_ATLAS_SIZE;
  if (!Number.isSafeInteger(size) || size < 64 || size > 16_384) {
    throw new RangeError("Minecraft atlas size must be an integer from 64 to 16384.");
  }
  return size;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal | undefined,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

function normalizePath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    normalized.includes("//") ||
    /[^a-z0-9_./-]/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function splitResourceLocation(reference: string): { namespace: string; path: string } | null {
  let namespace = "minecraft";
  let path = reference.trim();
  const colon = path.indexOf(":");
  if (colon >= 0) {
    namespace = path.slice(0, colon);
    path = path.slice(colon + 1);
  }
  const normalized = normalizePath(path);
  if (normalized === null || normalizePath(namespace) === null) return null;
  return { namespace, path: normalized };
}

/** Returns the path used by AssetsParser and the client jar, without `minecraft:`. */
export function normalizeMinecraftModelReference(reference: string): string | null {
  const location = splitResourceLocation(reference);
  if (!location || location.namespace !== "minecraft") return null;
  return location.path.replace(/^models\//, "").replace(/\.json$/i, "");
}

/** Returns e.g. `block/stone` for `minecraft:block/stone`. */
export function normalizeMinecraftTextureReference(reference: string): string | null {
  if (reference.startsWith("#")) return null;
  const location = splitResourceLocation(reference);
  if (!location || location.namespace !== "minecraft") return null;
  return location.path.replace(/^textures\//, "").replace(/\.png$/i, "");
}

function normalizeMinecraftBlockName(reference: string): string | null {
  const location = splitResourceLocation(reference);
  if (!location || location.namespace !== "minecraft") return null;
  return location.path.replace(/^blockstates\//, "").replace(/\.json$/i, "");
}

function collectApplyModels(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectApplyModels(entry, output);
    return;
  }
  if (!isRecord(value)) return;
  const model = asNonEmptyString(value.model);
  if (model !== null) output.add(model);
}

/** Collects every variant and multipart model reference without choosing a state yet. */
export function collectBlockStateModelReferences(value: unknown): ReadonlySet<string> {
  const output = new Set<string>();
  if (!isRecord(value)) return output;
  if (isRecord(value.variants)) {
    for (const apply of Object.values(value.variants)) collectApplyModels(apply, output);
  }
  if (Array.isArray(value.multipart)) {
    for (const part of value.multipart) {
      if (isRecord(part)) collectApplyModels(part.apply, output);
    }
  }
  return output;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function parseVersionManifest(value: unknown): readonly VersionManifestEntry[] {
  if (!isRecord(value) || !Array.isArray(value.versions)) {
    throw new MojangResourceError(
      "INVALID_MANIFEST",
      "Mojang version manifest does not contain a versions list.",
    );
  }
  const versions: VersionManifestEntry[] = [];
  for (const item of value.versions) {
    if (!isRecord(item)) continue;
    const id = asNonEmptyString(item.id);
    const url = asNonEmptyString(item.url);
    if (id !== null && url !== null) versions.push({ id, url });
  }
  if (versions.length === 0) {
    throw new MojangResourceError("INVALID_MANIFEST", "Mojang version manifest is empty.");
  }
  return versions;
}

function versionCandidates(input: string): readonly string[] {
  const trimmed = input.trim();
  const candidates = new Set<string>();
  if (trimmed.length > 0) candidates.add(trimmed);
  const withoutPrefix = trimmed.replace(/^minecraft\s*/i, "").trim();
  if (withoutPrefix.length > 0) candidates.add(withoutPrefix);
  for (const match of trimmed.matchAll(
    /(?:^|\D)(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)(?=$|\D)/g,
  )) {
    const candidate = match[1];
    if (candidate !== undefined) candidates.add(candidate);
  }
  const snapshot = trimmed.match(/\b\d{2}w\d{2}[a-z]\b/i)?.[0];
  if (snapshot !== undefined) candidates.add(snapshot.toLowerCase());
  return [...candidates];
}

function resolveManifestVersion(
  requestedVersion: string,
  versions: readonly VersionManifestEntry[],
): VersionManifestEntry {
  const byId = new Map(versions.map((entry) => [entry.id.toLowerCase(), entry]));
  for (const candidate of versionCandidates(requestedVersion)) {
    const match = byId.get(candidate.toLowerCase());
    if (match !== undefined) return match;
  }
  throw new MojangResourceError(
    "VERSION_NOT_FOUND",
    `Minecraft version “${requestedVersion}” was not found in Mojang's version manifest.`,
  );
}

function parseClientDownload(value: unknown): ClientDownload {
  if (!isRecord(value) || !isRecord(value.downloads) || !isRecord(value.downloads.client)) {
    throw new MojangResourceError(
      "CLIENT_DOWNLOAD_MISSING",
      "Mojang version metadata does not contain a client download.",
    );
  }
  const url = asNonEmptyString(value.downloads.client.url);
  const sha1 = asNonEmptyString(value.downloads.client.sha1);
  if (url === null || sha1 === null) {
    throw new MojangResourceError(
      "INVALID_VERSION_METADATA",
      "Mojang client download metadata is missing its URL or SHA-1.",
    );
  }
  return { url, sha1 };
}

async function defaultFetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetch(url, signal === undefined ? undefined : { signal });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    throw new MojangResourceError("NETWORK_ERROR", `Could not download ${url}.`, { cause: error });
  }
  if (!response.ok) {
    throw new MojangResourceError(
      "NETWORK_ERROR",
      `Could not download ${url}: HTTP ${response.status} ${response.statusText}.`,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new MojangResourceError("INVALID_VERSION_METADATA", `Invalid JSON returned by ${url}.`, {
      cause: error,
    });
  }
}

function mergedFetchSignal(
  requestSignal: AbortSignal | null | undefined,
  signal?: AbortSignal,
): AbortSignal | undefined {
  if (requestSignal && signal) return AbortSignal.any([requestSignal, signal]);
  return requestSignal ?? signal;
}

function archiveFetch(signal?: AbortSignal) {
  return (input: string, init?: RequestInit): Promise<Response> => {
    const combinedSignal = mergedFetchSignal(init?.signal, signal);
    const hasRange = new Headers(init?.headers).has("range");
    const requestInit: RequestInit | undefined =
      init === undefined && combinedSignal === undefined
        ? undefined
        : {
            ...init,
            ...(hasRange ? { cache: "no-store" } : {}),
            ...(combinedSignal === undefined ? {} : { signal: combinedSignal }),
          };
    return fetch(input, requestInit);
  };
}

async function openZipReader(
  reader: ConstructorParameters<typeof ZipReader>[0],
  signal?: AbortSignal,
): Promise<MojangArchive> {
  const zipReader = new ZipReader(reader, signal === undefined ? undefined : { signal });
  try {
    const entries = await zipReader.getEntries();
    throwIfAborted(signal);
    return new IndexedZipArchive(zipReader, entries);
  } catch (error) {
    await zipReader.close().catch(() => undefined);
    throw error;
  }
}

async function defaultOpenArchive(url: string, signal?: AbortSignal): Promise<MojangArchive> {
  throwIfAborted(signal);
  const errors: unknown[] = [];
  try {
    // Mojang exposes Content-Length on HEAD and accepts simple `bytes=start-end` ranges.
    // Avoid a suffix range for the first request: browsers preflight that form, while Mojang's
    // object host does not answer the OPTIONS request used by the preflight.
    const rangeOptions = {
      fetch: archiveFetch(signal),
      forceRangeRequests: true,
      preventHeadRequest: false,
      combineSizeEocd: false,
    } as ConstructorParameters<typeof HttpRangeReader>[1];
    return await openZipReader(new HttpRangeReader(url, rangeOptions), signal);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    errors.push(error);
  }

  try {
    // Some mirrors do not expose usable ranges; HttpReader can cache the full response instead.
    return await openZipReader(
      new HttpReader(url, { fetch: archiveFetch(signal), preventHeadRequest: true }),
      signal,
    );
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    errors.push(error);
  }

  try {
    // Last-resort compatibility path for hosts with unusual HEAD/range behavior.
    const response = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await openZipReader(new BlobReader(await response.blob()), signal);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    errors.push(error);
    throw new MojangResourceError(
      "ARCHIVE_OPEN_FAILED",
      `Could not open the Minecraft client archive at ${url}.`,
      { cause: new AggregateError(errors, "All Minecraft client archive readers failed.") },
    );
  }
}

async function defaultDecodePng(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedPng> {
  throwIfAborted(signal);
  if (typeof createImageBitmap !== "function") {
    throw new MojangResourceError(
      "CANVAS_UNAVAILABLE",
      "This browser cannot decode Minecraft PNG textures (createImageBitmap is unavailable).",
    );
  }
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }),
  );
  if (signal?.aborted) {
    bitmap.close();
    throwIfAborted(signal);
  }
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

function defaultCreateCanvas(width: number, height: number): AtlasCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new MojangResourceError(
    "CANVAS_UNAVAILABLE",
    "This browser cannot create a canvas for Minecraft textures.",
  );
}

const defaultDependencies: MojangResourceDependencies = {
  fetchJson: defaultFetchJson,
  openArchive: defaultOpenArchive,
  decodePng: defaultDecodePng,
  createCanvas: defaultCreateCanvas,
};

function dependenciesFor(
  overrides: Partial<MojangResourceDependencies> | undefined,
): MojangResourceDependencies {
  return { ...defaultDependencies, ...overrides };
}

function addIssue(
  issues: MojangResourceIssue[],
  code: MojangResourceIssueCode,
  message: string,
  resource: string | null,
  stateKey: string | null,
): void {
  issues.push({ code, message, resource, stateKey });
}

async function readJsonResource(
  archive: MojangArchive,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const text = await archive.readText(path, signal);
  throwIfAborted(signal);
  return parseJson(text);
}

async function loadBlockStates(
  archive: MojangArchive,
  states: readonly BlockState[],
  concurrency: number,
  signal: AbortSignal | undefined,
  issues: MojangResourceIssue[],
  fallback: Map<string, BlockState>,
): Promise<{ values: Map<string, BlockStates>; roots: Set<string> }> {
  const values = new Map<string, BlockStates>();
  const roots = new Set<string>();
  const uniqueBlocks = new Map<string, BlockState[]>();
  for (const state of states) {
    const blockName = normalizeMinecraftBlockName(state.name);
    if (blockName === null) {
      fallback.set(state.key, state);
      addIssue(
        issues,
        "UNSUPPORTED_NAMESPACE",
        `Only minecraft: block resources can be loaded from the vanilla client (${state.name}).`,
        state.name,
        state.key,
      );
      continue;
    }
    const related = uniqueBlocks.get(blockName) ?? [];
    related.push(state);
    uniqueBlocks.set(blockName, related);
  }

  await mapLimit([...uniqueBlocks.entries()], concurrency, signal, async ([blockName, related]) => {
    const path = `assets/minecraft/blockstates/${blockName}.json`;
    if (!archive.has(path)) {
      for (const state of related) {
        fallback.set(state.key, state);
        addIssue(
          issues,
          "BLOCKSTATE_MISSING",
          `Vanilla blockstate is missing: ${path}.`,
          path,
          state.key,
        );
      }
      return;
    }
    try {
      const value = await readJsonResource(archive, path, signal);
      if (!isRecord(value)) throw new TypeError("The blockstate root is not an object.");
      values.set(blockName, value);
      for (const reference of collectBlockStateModelReferences(value)) roots.add(reference);
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      for (const state of related) {
        fallback.set(state.key, state);
        addIssue(
          issues,
          "BLOCKSTATE_INVALID",
          `Vanilla blockstate JSON is invalid: ${path}.`,
          path,
          state.key,
        );
      }
    }
  });
  return { values, roots };
}

async function loadModelClosure(
  archive: MojangArchive,
  rootReferences: ReadonlySet<string>,
  concurrency: number,
  signal: AbortSignal | undefined,
  issues: MojangResourceIssue[],
): Promise<Map<string, BlockModel>> {
  const values = new Map<string, BlockModel>();
  const attempted = new Set<string>();
  let pending = [...rootReferences];

  while (pending.length > 0) {
    throwIfAborted(signal);
    const current: string[] = [];
    for (const reference of pending) {
      const model = normalizeMinecraftModelReference(reference);
      if (model === null) {
        addIssue(
          issues,
          "MODEL_MISSING",
          `Only minecraft: model references are supported (${reference}).`,
          reference,
          null,
        );
      } else if (!attempted.has(model)) {
        attempted.add(model);
        current.push(model);
      }
    }
    pending = [];

    const parents = await mapLimit(current, concurrency, signal, async (model) => {
      const path = `assets/minecraft/models/${model}.json`;
      if (!archive.has(path)) {
        addIssue(issues, "MODEL_MISSING", `Vanilla model is missing: ${path}.`, path, null);
        return null;
      }
      try {
        const value = await readJsonResource(archive, path, signal);
        if (!isRecord(value)) throw new TypeError("The model root is not an object.");
        const modelValue = value as BlockModel;
        values.set(model, modelValue);
        return asNonEmptyString(modelValue.parent);
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        addIssue(issues, "MODEL_INVALID", `Vanilla model JSON is invalid: ${path}.`, path, null);
        return null;
      }
    });
    pending.push(...parents.filter((parent): parent is string => parent !== null));
  }
  return values;
}

function resolvedTextureReferences(models: readonly ResolvedBlockModel[]): ReadonlySet<string> {
  const references = new Set<string>();
  for (const model of models) {
    for (const element of model.elements ?? []) {
      for (const face of Object.values(element.faces ?? {})) {
        let reference = face.texture;
        if (reference.startsWith("#")) {
          reference = model.textures?.[reference.slice(1)] ?? reference;
        }
        const normalized = normalizeMinecraftTextureReference(reference);
        if (normalized !== null) references.add(normalized);
      }
    }
  }
  return references;
}

function hasUnresolvedFaceTexture(models: readonly ResolvedBlockModel[]): boolean {
  for (const model of models) {
    for (const element of model.elements ?? []) {
      for (const face of Object.values(element.faces ?? {})) {
        let reference = face.texture;
        if (reference.startsWith("#"))
          reference = model.textures?.[reference.slice(1)] ?? reference;
        if (normalizeMinecraftTextureReference(reference) === null) return true;
      }
    }
  }
  return false;
}

function fluidTexture(state: BlockState): string | null {
  switch (state.name) {
    case "minecraft:water":
    case "minecraft:bubble_column":
      return "block/water_still";
    case "minecraft:lava":
      return "block/lava_still";
    default:
      return null;
  }
}

function resolveBlockModels(
  version: string,
  states: readonly BlockState[],
  blockStates: ReadonlyMap<string, BlockStates>,
  models: ReadonlyMap<string, BlockModel>,
  fallback: Map<string, BlockState>,
  issues: MojangResourceIssue[],
): {
  resolved: Map<string, readonly ResolvedBlockModel[]>;
  stateTextures: Map<string, ReadonlySet<string>>;
} {
  const blockStateStore = new RawMapStore(blockStates, normalizeMinecraftBlockName);
  const modelStore = new RawMapStore(models, normalizeMinecraftModelReference);
  const parser = new AssetsParser(
    version,
    blockStateStore as unknown as BlockStatesStore,
    modelStore as unknown as BlockModelsStore,
  );
  const resolved = new Map<string, readonly ResolvedBlockModel[]>();
  const stateTextures = new Map<string, ReadonlySet<string>>();

  for (const state of states) {
    if (fallback.has(state.key)) continue;
    const issueStart = parser.issues.length;
    try {
      const result = parser.getResolvedModelFirst(
        { name: state.name, properties: { ...state.properties } },
        false,
      );
      const cloned = result === undefined ? undefined : structuredClone(result);
      const fluid = fluidTexture(state);
      if (fluid !== null) {
        // Fluids are rendered procedurally by the preview, so their vanilla models intentionally
        // have no cuboid elements. Still load the official still texture into the atlas.
        resolved.set(state.key, cloned ?? []);
        stateTextures.set(state.key, new Set([fluid]));
        continue;
      }
      if (
        cloned === undefined ||
        cloned.length === 0 ||
        cloned.some(
          (model) => !model || !Array.isArray(model.elements) || model.elements.length === 0,
        ) ||
        hasUnresolvedFaceTexture(cloned)
      ) {
        throw new Error("No complete vanilla block model matched this state.");
      }
      resolved.set(state.key, cloned);
      stateTextures.set(state.key, resolvedTextureReferences(cloned));
    } catch {
      fallback.set(state.key, state);
      const parserDetails = parser.issues.slice(issueStart).join("; ");
      const detail = parserDetails.length > 0 ? ` ${parserDetails}` : "";
      addIssue(
        issues,
        "MODEL_UNRESOLVED",
        `Could not resolve a complete vanilla model for ${state.key}.${detail}`,
        state.name,
        state.key,
      );
    }
  }
  return { resolved, stateTextures };
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Computes the first displayed frame, including a non-zero first index in .png.mcmeta. */
export function animationFirstFrameRect(
  imageWidth: number,
  imageHeight: number,
  metadata: unknown,
): AnimationFrameRect {
  if (
    !Number.isSafeInteger(imageWidth) ||
    !Number.isSafeInteger(imageHeight) ||
    imageWidth < 1 ||
    imageHeight < 1
  ) {
    throw new RangeError("PNG dimensions must be positive integers.");
  }
  if (!isRecord(metadata) || !isRecord(metadata.animation)) {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }
  const animation = metadata.animation;
  const requestedWidth = positiveInteger(animation.width);
  const requestedHeight = positiveInteger(animation.height);
  const defaultSide = Math.min(imageWidth, imageHeight);
  const width = Math.min(requestedWidth ?? requestedHeight ?? defaultSide, imageWidth);
  const height = Math.min(requestedHeight ?? requestedWidth ?? defaultSide, imageHeight);
  const columns = Math.max(1, Math.floor(imageWidth / width));
  const rows = Math.max(1, Math.floor(imageHeight / height));
  const frameCount = columns * rows;
  let firstIndex = 0;
  const framesValue: unknown = animation.frames;
  if (Array.isArray(framesValue) && framesValue.length > 0) {
    const first: unknown = framesValue[0];
    if (typeof first === "number" && Number.isSafeInteger(first)) firstIndex = first;
    if (isRecord(first) && typeof first.index === "number" && Number.isSafeInteger(first.index)) {
      firstIndex = first.index;
    }
  }
  firstIndex = Math.max(0, Math.min(frameCount - 1, firstIndex));
  return {
    x: (firstIndex % columns) * width,
    y: Math.floor(firstIndex / columns) * height,
    width,
    height,
  };
}

async function textureAnimationMetadata(
  archive: MojangArchive,
  texture: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const path = `assets/minecraft/textures/${texture}.png.mcmeta`;
  if (!archive.has(path)) return null;
  try {
    return await readJsonResource(archive, path, signal);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return null;
  }
}

async function loadTextures(
  archive: MojangArchive,
  textureReferences: readonly string[],
  concurrency: number,
  signal: AbortSignal | undefined,
  dependencies: MojangResourceDependencies,
  issues: MojangResourceIssue[],
): Promise<{ loaded: LoadedTexture[]; failed: Set<string> }> {
  const failed = new Set<string>();
  const results = await mapLimit(textureReferences, concurrency, signal, async (texture) => {
    const path = `assets/minecraft/textures/${texture}.png`;
    if (!archive.has(path)) {
      failed.add(texture);
      addIssue(issues, "TEXTURE_MISSING", `Vanilla texture is missing: ${path}.`, path, null);
      return null;
    }
    let decoded: DecodedPng | undefined;
    try {
      // Keep archive range reads inside the caller's global concurrency budget.
      const bytes = await archive.readBytes(path, signal);
      const metadata = await textureAnimationMetadata(archive, texture, signal);
      decoded = await dependencies.decodePng(bytes, signal);
      if (
        !Number.isSafeInteger(decoded.width) ||
        !Number.isSafeInteger(decoded.height) ||
        decoded.width < 1 ||
        decoded.height < 1
      ) {
        throw new Error("Decoded PNG dimensions are invalid.");
      }
      return {
        texture,
        decoded,
        frame: animationFirstFrameRect(decoded.width, decoded.height, metadata),
      } satisfies LoadedTexture;
    } catch (error) {
      decoded?.close?.();
      if (isAbort(error, signal)) throw error;
      failed.add(texture);
      addIssue(issues, "TEXTURE_INVALID", `Could not decode vanilla texture: ${path}.`, path, null);
      return null;
    }
  });
  return {
    loaded: results.filter((texture): texture is LoadedTexture => texture !== null),
    failed,
  };
}

function newSheet(): AtlasSheet {
  return {
    placements: [],
    cursorX: 0,
    cursorY: 0,
    rowHeight: 0,
    usedWidth: 0,
    usedHeight: 0,
  };
}

function placeTextures(textures: readonly LoadedTexture[], maxAtlasSize: number): AtlasSheet[] {
  const sheets: AtlasSheet[] = [];
  for (const texture of textures) {
    const paddedWidth = texture.frame.width + ATLAS_PADDING * 2;
    const paddedHeight = texture.frame.height + ATLAS_PADDING * 2;
    if (paddedWidth > maxAtlasSize || paddedHeight > maxAtlasSize) {
      throw new RangeError(
        `Minecraft texture ${texture.texture} (${texture.frame.width}x${texture.frame.height}) exceeds the atlas limit ${maxAtlasSize}.`,
      );
    }
    let sheet = sheets.at(-1);
    if (sheet === undefined) {
      sheet = newSheet();
      sheets.push(sheet);
    }
    if (sheet.cursorX + paddedWidth > maxAtlasSize) {
      sheet.cursorX = 0;
      sheet.cursorY += sheet.rowHeight;
      sheet.rowHeight = 0;
    }
    if (sheet.cursorY + paddedHeight > maxAtlasSize) {
      sheet = newSheet();
      sheets.push(sheet);
    }
    const placement: PendingPlacement = {
      ...texture,
      atlasIndex: sheets.length - 1,
      x: sheet.cursorX + ATLAS_PADDING,
      y: sheet.cursorY + ATLAS_PADDING,
    };
    sheet.placements.push(placement);
    sheet.cursorX += paddedWidth;
    sheet.rowHeight = Math.max(sheet.rowHeight, paddedHeight);
    sheet.usedWidth = Math.max(sheet.usedWidth, sheet.cursorX);
    sheet.usedHeight = Math.max(sheet.usedHeight, sheet.cursorY + sheet.rowHeight);
  }
  return sheets;
}

interface Canvas2DLike {
  imageSmoothingEnabled: boolean;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

function renderAtlases(
  textures: readonly LoadedTexture[],
  maxAtlasSize: number,
  createCanvas: MojangResourceDependencies["createCanvas"],
): { atlases: MojangTextureAtlas[]; lookup: Map<string, AtlasTextureRegion> } {
  const sheets = placeTextures(textures, maxAtlasSize);
  const atlases: MojangTextureAtlas[] = [];
  const lookup = new Map<string, AtlasTextureRegion>();
  for (let atlasIndex = 0; atlasIndex < sheets.length; atlasIndex += 1) {
    const sheet = sheets[atlasIndex];
    if (sheet === undefined) continue;
    const width = Math.max(1, sheet.usedWidth);
    const height = Math.max(1, sheet.usedHeight);
    const canvas = createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d") as Canvas2DLike | null;
    if (context === null) {
      throw new MojangResourceError(
        "CANVAS_UNAVAILABLE",
        "A 2D canvas context is required to build the Minecraft texture atlas.",
      );
    }
    context.imageSmoothingEnabled = false;
    for (const placement of sheet.placements) {
      const { frame } = placement;
      context.drawImage(
        placement.decoded.source,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        placement.x,
        placement.y,
        frame.width,
        frame.height,
      );
      lookup.set(placement.texture, {
        texture: placement.texture,
        atlasIndex,
        x: placement.x,
        y: placement.y,
        width: frame.width,
        height: frame.height,
        u0: placement.x / width,
        v0: placement.y / height,
        u1: (placement.x + frame.width) / width,
        v1: (placement.y + frame.height) / height,
      });
    }
    atlases.push({ canvas, width, height });
  }
  return { atlases, lookup };
}

function finalizeTextureFailures(
  states: readonly BlockState[],
  failedTextures: ReadonlySet<string>,
  stateTextures: ReadonlyMap<string, ReadonlySet<string>>,
  resolvedModels: Map<string, readonly ResolvedBlockModel[]>,
  fallback: Map<string, BlockState>,
  issues: MojangResourceIssue[],
): void {
  for (const state of states) {
    if (fallback.has(state.key)) continue;
    const textures = stateTextures.get(state.key);
    const missing =
      textures === undefined ? [] : [...textures].filter((texture) => failedTextures.has(texture));
    if (textures === undefined || textures.size === 0 || missing.length > 0) {
      fallback.set(state.key, state);
      resolvedModels.delete(state.key);
      const description =
        missing.length > 0
          ? `missing textures: ${missing.join(", ")}`
          : "no renderable face textures";
      addIssue(
        issues,
        "TEXTURE_MISSING",
        `Vanilla model for ${state.key} has ${description}.`,
        missing[0] ?? state.name,
        state.key,
      );
    }
  }
}

function orderedFallbackStates(
  states: readonly BlockState[],
  fallback: ReadonlyMap<string, BlockState>,
): BlockState[] {
  const output: BlockState[] = [];
  const seen = new Set<string>();
  for (const state of states) {
    if (!fallback.has(state.key) || seen.has(state.key)) continue;
    seen.add(state.key);
    output.push(state);
  }
  return output;
}

/**
 * Lazily loads only the requested vanilla block resources from Mojang's client jar.
 * Nothing is written to disk or bundled into the application.
 */
export async function loadMojangResources(
  options: LoadMojangResourcesOptions,
): Promise<MojangResolvedResources> {
  const { signal } = options;
  throwIfAborted(signal);
  const concurrency = normalizedLimit(options.concurrency);
  const maxAtlasSize = normalizedAtlasSize(options.maxAtlasSize);
  const dependencies = dependenciesFor(options.dependencies);
  const issues: MojangResourceIssue[] = [];
  const fallback = new Map<string, BlockState>();

  let manifestValue: unknown;
  try {
    manifestValue = await dependencies.fetchJson(MOJANG_VERSION_MANIFEST_URL, signal);
  } catch (error) {
    if (isAbort(error, signal) || error instanceof MojangResourceError) throw error;
    throw new MojangResourceError(
      "NETWORK_ERROR",
      "Could not download Mojang's version manifest.",
      {
        cause: error,
      },
    );
  }
  const manifestEntry = resolveManifestVersion(
    options.version,
    parseVersionManifest(manifestValue),
  );

  let metadataValue: unknown;
  try {
    metadataValue = await dependencies.fetchJson(manifestEntry.url, signal);
  } catch (error) {
    if (isAbort(error, signal) || error instanceof MojangResourceError) throw error;
    throw new MojangResourceError(
      "NETWORK_ERROR",
      `Could not download metadata for Minecraft ${manifestEntry.id}.`,
      { cause: error },
    );
  }
  const client = parseClientDownload(metadataValue);

  let archive: MojangArchive;
  try {
    archive = await dependencies.openArchive(client.url, signal);
  } catch (error) {
    if (isAbort(error, signal) || error instanceof MojangResourceError) throw error;
    throw new MojangResourceError(
      "ARCHIVE_OPEN_FAILED",
      `Could not open the Minecraft ${manifestEntry.id} client archive.`,
      { cause: error },
    );
  }

  let loadedTextures: LoadedTexture[] = [];
  try {
    const blockResources = await loadBlockStates(
      archive,
      options.states,
      concurrency,
      signal,
      issues,
      fallback,
    );
    const modelResources = await loadModelClosure(
      archive,
      blockResources.roots,
      concurrency,
      signal,
      issues,
    );
    const modelResolution = resolveBlockModels(
      manifestEntry.id,
      options.states,
      blockResources.values,
      modelResources,
      fallback,
      issues,
    );
    const textureReferences = new Set<string>();
    for (const references of modelResolution.stateTextures.values()) {
      for (const texture of references) textureReferences.add(texture);
    }
    const textureResult = await loadTextures(
      archive,
      [...textureReferences],
      concurrency,
      signal,
      dependencies,
      issues,
    );
    loadedTextures = textureResult.loaded;
    finalizeTextureFailures(
      options.states,
      textureResult.failed,
      modelResolution.stateTextures,
      modelResolution.resolved,
      fallback,
      issues,
    );
    const atlases = renderAtlases(loadedTextures, maxAtlasSize, (width, height) =>
      dependencies.createCanvas(width, height),
    );
    return {
      version: manifestEntry.id,
      clientUrl: client.url,
      clientSha1: client.sha1,
      resolvedModels: modelResolution.resolved,
      textureLookup: atlases.lookup,
      atlases: atlases.atlases,
      fallbackStates: orderedFallbackStates(options.states, fallback),
      issues,
    };
  } finally {
    for (const texture of loadedTextures) texture.decoded.close?.();
    await archive.close().catch(() => undefined);
  }
}
