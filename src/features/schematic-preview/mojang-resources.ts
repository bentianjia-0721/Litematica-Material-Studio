import { BlobReader, ZipReader, type Entry } from "@zip.js/zip.js";
import { AssetsParser } from "mc-assets/dist/assetsParser.js";
import type { BlockModelsStore, BlockStatesStore } from "mc-assets/dist/stores.js";
import type { BlockModel, BlockStates, ResolvedBlockModel } from "mc-assets/dist/types.js";
import type { BlockState } from "../../lib/litematic";

export const BUNDLED_MINECRAFT_VERSION = "1.21.11";
export const BUNDLED_MINECRAFT_CLIENT_SHA1 = "ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd";
export const BUNDLED_MINECRAFT_ARCHIVE_PATH = "minecraft-assets/minecraft-1.21.11-preview.zip";
export const XKRD_ARCHIVE_PATH = "resource-packs/XKRD-Redstone-Display-v3.3-for-1.21.zip";
export const XKRD_ARCHIVE_SHA256 =
  "1861d354f6a4ad0cd20d661965dfa179be53c8895f45b1e53562cd50d1536c57";

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
  "ABORTED" | "NETWORK_ERROR" | "ARCHIVE_OPEN_FAILED" | "CANVAS_UNAVAILABLE";

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
  readonly archiveUrl: string;
  readonly sourceClientSha1: string;
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
  readonly states: readonly BlockState[];
  /** Applies the bundled XKRD pack before vanilla resources, with per-state vanilla fallback. */
  readonly useXkrd?: boolean;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly maxAtlasSize?: number;
  readonly dependencies?: Partial<MojangResourceDependencies>;
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

/**
 * A read-only resource-pack view. A path present in the overlay always wins; absent paths are
 * read from the fallback archive. Invalid overlay data is deliberately not hidden here so the
 * caller can reject that state and retry it against a pure vanilla archive.
 */
export class OverlayArchive implements MojangArchive {
  constructor(
    private readonly overlay: MojangArchive,
    private readonly fallback: MojangArchive,
  ) {}

  has(path: string): boolean {
    return this.overlay.has(path) || this.fallback.has(path);
  }

  readText(path: string, signal?: AbortSignal): Promise<string> {
    return (this.overlay.has(path) ? this.overlay : this.fallback).readText(path, signal);
  }

  readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    return (this.overlay.has(path) ? this.overlay : this.fallback).readBytes(path, signal);
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled([this.overlay.close(), this.fallback.close()]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected !== undefined) throw rejected.reason;
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

function normalizedResourceKey(namespace: string, path: string): string {
  return namespace === "minecraft" ? path : `${namespace}:${path}`;
}

function normalizeBlockReference(reference: string): string | null {
  const location = splitResourceLocation(reference);
  if (!location) return null;
  const path = location.path.replace(/^blockstates\//, "").replace(/\.json$/i, "");
  return normalizedResourceKey(location.namespace, path);
}

function normalizeModelReference(reference: string): string | null {
  const location = splitResourceLocation(reference);
  if (!location) return null;
  const path = location.path.replace(/^models\//, "").replace(/\.json$/i, "");
  return normalizedResourceKey(location.namespace, path);
}

function normalizeTextureReference(reference: string): string | null {
  if (reference.startsWith("#")) return null;
  const location = splitResourceLocation(reference);
  if (!location) return null;
  const path = location.path.replace(/^textures\//, "").replace(/\.png$/i, "");
  return normalizedResourceKey(location.namespace, path);
}

function archiveResourcePath(
  kind: "blockstates" | "models" | "textures",
  normalizedReference: string,
  extension: ".json" | ".png" | ".png.mcmeta",
): string {
  const location = splitResourceLocation(normalizedReference);
  if (!location) throw new TypeError(`Invalid resource location: ${normalizedReference}`);
  return `assets/${location.namespace}/${kind}/${location.path}${extension}`;
}

/** Returns the path used by AssetsParser and the client jar, without `minecraft:`. */
export function normalizeMinecraftModelReference(reference: string): string | null {
  const location = splitResourceLocation(reference);
  if (!location || location.namespace !== "minecraft") return null;
  return normalizeModelReference(reference);
}

/** Returns e.g. `block/stone` for `minecraft:block/stone`. */
export function normalizeMinecraftTextureReference(reference: string): string | null {
  const location = splitResourceLocation(reference);
  if (!location || location.namespace !== "minecraft") return null;
  return normalizeTextureReference(reference);
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

export function bundledMinecraftArchiveUrl(basePath: string = import.meta.env.BASE_URL): string {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${normalizedBase}${BUNDLED_MINECRAFT_ARCHIVE_PATH}`;
}

export function xkrdArchiveUrl(basePath: string = import.meta.env.BASE_URL): string {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${normalizedBase}${XKRD_ARCHIVE_PATH}`;
}

const bundledArchiveDownloads = new Map<string, Promise<Blob>>();

async function downloadBundledArchive(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
  } catch (error) {
    throw new MojangResourceError(
      "NETWORK_ERROR",
      `无法读取内置 Minecraft ${BUNDLED_MINECRAFT_VERSION} 预览资源。`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new MojangResourceError(
      "NETWORK_ERROR",
      `无法读取内置 Minecraft ${BUNDLED_MINECRAFT_VERSION} 预览资源：HTTP ${response.status} ${response.statusText}。`,
    );
  }
  return await response.blob();
}

function bundledArchiveBlob(url: string): Promise<Blob> {
  const existing = bundledArchiveDownloads.get(url);
  if (existing !== undefined) return existing;
  const pending = downloadBundledArchive(url).catch((error: unknown) => {
    bundledArchiveDownloads.delete(url);
    throw error;
  });
  bundledArchiveDownloads.set(url, pending);
  return pending;
}

async function waitForBlob(promise: Promise<Blob>, signal?: AbortSignal): Promise<Blob> {
  throwIfAborted(signal);
  if (signal === undefined) return await promise;
  return await new Promise<Blob>((resolve, reject) => {
    const onAbort = () => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new MojangResourceError("ABORTED", "Minecraft resource loading was cancelled."),
        );
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (blob) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) onAbort();
        else resolve(blob);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("内置 Minecraft 资源读取失败。"));
      },
    );
  });
}

/** Starts the same-origin archive download before a projection is selected. */
export async function preloadBundledMinecraftArchive(
  basePath: string = import.meta.env.BASE_URL,
): Promise<void> {
  await bundledArchiveBlob(bundledMinecraftArchiveUrl(basePath));
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
  try {
    const blob = await waitForBlob(bundledArchiveBlob(url), signal);
    return await openZipReader(new BlobReader(blob), signal);
  } catch (error) {
    if (isAbort(error, signal) || error instanceof MojangResourceError) throw error;
    throw new MojangResourceError(
      "ARCHIVE_OPEN_FAILED",
      `无法打开内置 Minecraft ${BUNDLED_MINECRAFT_VERSION} 预览资源。`,
      { cause: error },
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

/** Rejects resource-pack selectors such as `bottom=true,1` before mc-assets can treat them as a match. */
function hasMalformedVariantSelector(value: JsonRecord): boolean {
  if (!isRecord(value.variants)) return false;
  return Object.keys(value.variants).some((selector) => {
    if (selector === "" || selector === "normal") return false;
    return selector.split(",").some((condition) => {
      const separator = condition.indexOf("=");
      return separator <= 0 || separator === condition.length - 1;
    });
  });
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
    const blockLocation = splitResourceLocation(state.name);
    const blockName = normalizeBlockReference(state.name);
    if (
      blockName === null ||
      blockLocation === null ||
      (blockLocation.namespace !== "minecraft" && blockLocation.namespace !== "create")
    ) {
      fallback.set(state.key, state);
      addIssue(
        issues,
        "UNSUPPORTED_NAMESPACE",
        `Only minecraft: and create: block resources are supported (${state.name}).`,
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
    const path = archiveResourcePath("blockstates", blockName, ".json");
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
      if (hasMalformedVariantSelector(value)) {
        for (const state of related) {
          fallback.set(state.key, state);
          addIssue(
            issues,
            "BLOCKSTATE_INVALID",
            `Blockstate has a malformed variant selector and requires per-state fallback: ${path}.`,
            path,
            state.key,
          );
        }
        return;
      }
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
      const model = normalizeModelReference(reference);
      if (model === null) {
        addIssue(
          issues,
          "MODEL_MISSING",
          `The model resource location is invalid (${reference}).`,
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
      const path = archiveResourcePath("models", model, ".json");
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
        const normalized = normalizeTextureReference(reference);
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
        if (normalizeTextureReference(reference) === null) return true;
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

function isCompleteResolvedModel(
  models: readonly ResolvedBlockModel[] | undefined,
): models is readonly ResolvedBlockModel[] {
  return (
    models !== undefined &&
    models.length > 0 &&
    models.every((model) => model && Array.isArray(model.elements) && model.elements.length > 0) &&
    !hasUnresolvedFaceTexture(models)
  );
}

function resolveBlockModels(
  version: string,
  states: readonly BlockState[],
  blockStates: ReadonlyMap<string, BlockStates>,
  models: ReadonlyMap<string, BlockModel>,
  fallback: Map<string, BlockState>,
  issues: MojangResourceIssue[],
  allowFallbackVariant: boolean,
): {
  resolved: Map<string, readonly ResolvedBlockModel[]>;
  stateTextures: Map<string, ReadonlySet<string>>;
} {
  const blockStateStore = new RawMapStore(blockStates, normalizeBlockReference);
  const modelStore = new RawMapStore(models, normalizeModelReference);
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
      const queriedState = { name: state.name, properties: { ...state.properties } };
      const exact = parser.getResolvedModelFirst(queriedState, false);
      let cloned = exact === undefined ? undefined : structuredClone(exact);
      const fluid = fluidTexture(state);
      if (fluid !== null) {
        // Fluids are rendered procedurally by the preview, so their vanilla models intentionally
        // have no cuboid elements. Still load the official still texture into the atlas.
        resolved.set(state.key, cloned ?? []);
        stateTextures.set(state.key, new Set([fluid]));
        continue;
      }
      if (!isCompleteResolvedModel(cloned) && allowFallbackVariant) {
        const compatible = parser.getResolvedModelFirst(queriedState, allowFallbackVariant);
        cloned = compatible === undefined ? undefined : structuredClone(compatible);
      }
      if (!isCompleteResolvedModel(cloned)) {
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
  const path = archiveResourcePath("textures", texture, ".png.mcmeta");
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
    const path = archiveResourcePath("textures", texture, ".png");
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

interface ResourcePassOptions {
  readonly archive: MojangArchive;
  readonly archiveUrl: string;
  readonly states: readonly BlockState[];
  readonly allowFallbackVariant: boolean;
  readonly signal: AbortSignal | undefined;
  readonly concurrency: number;
  readonly maxAtlasSize: number;
  readonly dependencies: MojangResourceDependencies;
}

async function loadResourcePass(options: ResourcePassOptions): Promise<MojangResolvedResources> {
  const { archive, archiveUrl, states, allowFallbackVariant, signal, dependencies } = options;
  const issues: MojangResourceIssue[] = [];
  const fallback = new Map<string, BlockState>();
  let loadedTextures: LoadedTexture[] = [];
  try {
    const blockResources = await loadBlockStates(
      archive,
      states,
      options.concurrency,
      signal,
      issues,
      fallback,
    );
    const modelResources = await loadModelClosure(
      archive,
      blockResources.roots,
      options.concurrency,
      signal,
      issues,
    );
    const modelResolution = resolveBlockModels(
      BUNDLED_MINECRAFT_VERSION,
      options.states,
      blockResources.values,
      modelResources,
      fallback,
      issues,
      allowFallbackVariant,
    );
    const textureReferences = new Set<string>();
    for (const references of modelResolution.stateTextures.values()) {
      for (const texture of references) textureReferences.add(texture);
    }
    const textureResult = await loadTextures(
      archive,
      [...textureReferences],
      options.concurrency,
      signal,
      dependencies,
      issues,
    );
    loadedTextures = textureResult.loaded;
    finalizeTextureFailures(
      states,
      textureResult.failed,
      modelResolution.stateTextures,
      modelResolution.resolved,
      fallback,
      issues,
    );
    const atlases = renderAtlases(loadedTextures, options.maxAtlasSize, (width, height) =>
      dependencies.createCanvas(width, height),
    );
    return {
      version: BUNDLED_MINECRAFT_VERSION,
      archiveUrl,
      sourceClientSha1: BUNDLED_MINECRAFT_CLIENT_SHA1,
      resolvedModels: modelResolution.resolved,
      textureLookup: atlases.lookup,
      atlases: atlases.atlases,
      fallbackStates: orderedFallbackStates(states, fallback),
      issues,
    };
  } finally {
    for (const texture of loadedTextures) texture.decoded.close?.();
    await archive.close().catch(() => undefined);
  }
}

async function openResourceArchive(
  url: string,
  dependencies: MojangResourceDependencies,
  signal?: AbortSignal,
): Promise<MojangArchive> {
  try {
    return await dependencies.openArchive(url, signal);
  } catch (error) {
    if (isAbort(error, signal) || error instanceof MojangResourceError) throw error;
    throw new MojangResourceError(
      "ARCHIVE_OPEN_FAILED",
      `无法打开内置 Minecraft ${BUNDLED_MINECRAFT_VERSION} 预览资源。`,
      { cause: error },
    );
  }
}

function mergeResourcePasses(
  overlay: MojangResolvedResources,
  vanillaRetry: MojangResolvedResources,
): MojangResolvedResources {
  const retryTextureKey = (texture: string) => `__vanilla_retry__/${texture}`;
  const rewriteRetryTextureReference = (reference: string): string => {
    if (reference.startsWith("#")) return reference;
    const normalized = normalizeTextureReference(reference);
    return normalized === null ? reference : retryTextureKey(normalized);
  };
  const rewriteRetryModel = (model: ResolvedBlockModel): ResolvedBlockModel => {
    const rewritten = structuredClone(model);
    if (rewritten.textures !== undefined) {
      for (const [key, reference] of Object.entries(rewritten.textures)) {
        rewritten.textures[key] = rewriteRetryTextureReference(reference);
      }
    }
    for (const element of rewritten.elements ?? []) {
      for (const face of Object.values(element.faces ?? {})) {
        face.texture = rewriteRetryTextureReference(face.texture);
      }
    }
    return rewritten;
  };
  const atlasOffset = overlay.atlases.length;
  const resolvedModels = new Map(overlay.resolvedModels);
  for (const [stateKey, models] of vanillaRetry.resolvedModels) {
    resolvedModels.set(stateKey, models.map(rewriteRetryModel));
  }
  const textureLookup = new Map(overlay.textureLookup);
  for (const [texture, region] of vanillaRetry.textureLookup) {
    const retryRegion = {
      ...region,
      texture: retryTextureKey(texture),
      atlasIndex: region.atlasIndex + atlasOffset,
    };
    textureLookup.set(retryRegion.texture, retryRegion);
    // Procedural fluids use an unqualified fixed texture key. Preserve that alias only when it
    // cannot overwrite an XKRD texture used by an already-resolved overlay state.
    if (!textureLookup.has(texture)) textureLookup.set(texture, retryRegion);
  }
  return {
    version: BUNDLED_MINECRAFT_VERSION,
    archiveUrl: overlay.archiveUrl,
    sourceClientSha1: BUNDLED_MINECRAFT_CLIENT_SHA1,
    resolvedModels,
    textureLookup,
    atlases: [...overlay.atlases, ...vanillaRetry.atlases],
    fallbackStates: vanillaRetry.fallbackStates,
    issues: [...overlay.issues, ...vanillaRetry.issues],
  };
}

/** Reads only the requested states from the bundled Minecraft 1.21.11 preview resources. */
export async function loadMojangResources(
  options: LoadMojangResourcesOptions,
): Promise<MojangResolvedResources> {
  const { signal } = options;
  throwIfAborted(signal);
  const concurrency = normalizedLimit(options.concurrency);
  const maxAtlasSize = normalizedAtlasSize(options.maxAtlasSize);
  const dependencies = dependenciesFor(options.dependencies);
  const vanillaUrl = bundledMinecraftArchiveUrl();
  const loadVanillaOnly = async (): Promise<MojangResolvedResources> => {
    const archive = await openResourceArchive(vanillaUrl, dependencies, signal);
    return await loadResourcePass({
      archive,
      archiveUrl: vanillaUrl,
      states: options.states,
      allowFallbackVariant: true,
      signal,
      concurrency,
      maxAtlasSize,
      dependencies,
    });
  };

  if (options.useXkrd !== true) {
    return await loadVanillaOnly();
  }

  const overlayUrl = xkrdArchiveUrl();
  let overlayArchive: MojangArchive;
  try {
    overlayArchive = await openResourceArchive(overlayUrl, dependencies, signal);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return await loadVanillaOnly();
  }
  let vanillaForOverlay: MojangArchive;
  try {
    vanillaForOverlay = await openResourceArchive(vanillaUrl, dependencies, signal);
  } catch (error) {
    await overlayArchive.close().catch(() => undefined);
    if (isAbort(error, signal)) throw error;
    return await loadVanillaOnly();
  }
  let overlayPass: MojangResolvedResources;
  try {
    overlayPass = await loadResourcePass({
      archive: new OverlayArchive(overlayArchive, vanillaForOverlay),
      archiveUrl: overlayUrl,
      states: options.states,
      // Never select an arbitrary XKRD variant. A miss is retried against pure vanilla below.
      allowFallbackVariant: false,
      signal,
      concurrency,
      maxAtlasSize,
      dependencies,
    });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return await loadVanillaOnly();
  }
  if (overlayPass.fallbackStates.length === 0) return overlayPass;

  try {
    const vanillaRetryArchive = await openResourceArchive(vanillaUrl, dependencies, signal);
    const vanillaRetry = await loadResourcePass({
      archive: vanillaRetryArchive,
      archiveUrl: vanillaUrl,
      states: overlayPass.fallbackStates,
      allowFallbackVariant: true,
      signal,
      concurrency,
      maxAtlasSize,
      dependencies,
    });
    return mergeResourcePasses(overlayPass, vanillaRetry);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    // Keep every state the overlay pass resolved; only its already-declared fallback states use
    // the coloured safety mesh when a later vanilla retry cannot be opened or decoded.
    return overlayPass;
  }
}
