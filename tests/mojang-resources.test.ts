import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { BlockState } from "../src/lib/litematic";
import {
  BUNDLED_MINECRAFT_ARCHIVE_PATH,
  BUNDLED_MINECRAFT_CLIENT_SHA1,
  BUNDLED_MINECRAFT_VERSION,
  OverlayArchive,
  XKRD_ARCHIVE_PATH,
  XKRD_ARCHIVE_SHA256,
  animationFirstFrameRect,
  bundledMinecraftArchiveUrl,
  collectBlockStateModelReferences,
  loadMojangResources,
  normalizeMinecraftModelReference,
  normalizeMinecraftTextureReference,
  preloadBundledMinecraftArchive,
  xkrdArchiveUrl,
  type DecodedPng,
  type MojangArchive,
} from "../src/features/schematic-preview/mojang-resources";

class FakeArchive implements MojangArchive {
  readonly reads: string[] = [];
  closed = false;
  maxActiveReads = 0;
  private activeReads = 0;

  constructor(
    private readonly textResources: ReadonlyMap<string, string>,
    private readonly byteResources: ReadonlyMap<string, Uint8Array>,
  ) {}

  has(path: string): boolean {
    return this.textResources.has(path) || this.byteResources.has(path);
  }

  async readText(path: string, signal?: AbortSignal): Promise<string> {
    return await this.read(path, signal, () => {
      const value = this.textResources.get(path);
      if (value === undefined) throw new Error(`Missing fake text resource: ${path}`);
      return value;
    });
  }

  async readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    return await this.read(path, signal, () => {
      const value = this.byteResources.get(path);
      if (value === undefined) throw new Error(`Missing fake byte resource: ${path}`);
      return value;
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  private async read<T>(path: string, signal: AbortSignal | undefined, value: () => T): Promise<T> {
    signal?.throwIfAborted();
    this.reads.push(path);
    this.activeReads += 1;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    try {
      await Promise.resolve();
      return value();
    } finally {
      this.activeReads -= 1;
    }
  }
}

interface DrawCall {
  readonly source: CanvasImageSource;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

function state(name: string, properties: Readonly<Record<string, string>> = {}): BlockState {
  const serialized = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return {
    name,
    properties,
    key: serialized.length > 0 ? `${name}[${serialized}]` : name,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("Mojang resource helpers", () => {
  it("resolves the fixed same-origin preview archive under production and test bases", () => {
    expect(bundledMinecraftArchiveUrl("/")).toBe(`/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`);
    expect(bundledMinecraftArchiveUrl("/test")).toBe(`/test/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`);
  });

  it("resolves the bundled XKRD archive under production and test bases", () => {
    expect(xkrdArchiveUrl("/")).toBe(`/${XKRD_ARCHIVE_PATH}`);
    expect(xkrdArchiveUrl("/test")).toBe(`/test/${XKRD_ARCHIVE_PATH}`);
  });

  it("reads overlay paths first, falls through absent paths, and closes both archives", async () => {
    const overlay = new FakeArchive(new Map([["shared.json", "overlay"]]), new Map());
    const fallback = new FakeArchive(
      new Map([
        ["shared.json", "vanilla"],
        ["vanilla-only.json", "fallback"],
      ]),
      new Map(),
    );
    const archive = new OverlayArchive(overlay, fallback);

    await expect(archive.readText("shared.json")).resolves.toBe("overlay");
    await expect(archive.readText("vanilla-only.json")).resolves.toBe("fallback");
    await archive.close();

    expect(overlay.reads).toEqual(["shared.json"]);
    expect(fallback.reads).toEqual(["vanilla-only.json"]);
    expect(overlay.closed).toBe(true);
    expect(fallback.closed).toBe(true);
  });

  it("preloads a same-origin archive only once for a base path", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = (input: RequestInfo | URL) => {
      fetchCalls.push(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      return Promise.resolve(new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }));
    };
    try {
      await Promise.all([
        preloadBundledMinecraftArchive("/unit-preload/"),
        preloadBundledMinecraftArchive("/unit-preload/"),
      ]);
      expect(fetchCalls).toEqual([`/unit-preload/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("collects model references from every variant and multipart apply form", () => {
    const references = collectBlockStateModelReferences({
      variants: {
        "": { model: "minecraft:block/base" },
        "facing=north": [
          { model: "minecraft:block/north_a", weight: 2 },
          { model: "minecraft:block/north_b" },
        ],
      },
      multipart: [
        { apply: { model: "minecraft:block/post" } },
        { when: { north: "true" }, apply: [{ model: "minecraft:block/arm" }] },
      ],
    });

    expect([...references].sort()).toEqual([
      "minecraft:block/arm",
      "minecraft:block/base",
      "minecraft:block/north_a",
      "minecraft:block/north_b",
      "minecraft:block/post",
    ]);
  });

  it("normalizes vanilla model and resolved texture resource locations", () => {
    expect(normalizeMinecraftModelReference("minecraft:block/cube_all")).toBe("block/cube_all");
    expect(normalizeMinecraftModelReference("models/block/cube.json")).toBe("block/cube");
    expect(normalizeMinecraftTextureReference("minecraft:block/oak_planks")).toBe(
      "block/oak_planks",
    );
    expect(normalizeMinecraftTextureReference("textures/block/stone.png")).toBe("block/stone");
    expect(normalizeMinecraftTextureReference("example:block/machine")).toBeNull();
  });

  it("crops the first displayed frame from an animated vertical texture", () => {
    expect(
      animationFirstFrameRect(16, 64, { animation: { frames: [{ index: 2 }, 0, 1] } }),
    ).toEqual({
      x: 0,
      y: 32,
      width: 16,
      height: 16,
    });
    expect(animationFirstFrameRect(32, 16, null)).toEqual({
      x: 0,
      y: 0,
      width: 32,
      height: 16,
    });
  });
});

describe("bundled Minecraft preview archive", () => {
  it("matches its reproducible manifest and contains the fixed resource roots", async () => {
    const directory = path.resolve(process.cwd(), "public/minecraft-assets");
    const archiveBytes = await readFile(
      path.join(directory, `minecraft-${BUNDLED_MINECRAFT_VERSION}-preview.zip`),
    );
    const manifest = JSON.parse(
      await readFile(
        path.join(directory, `minecraft-${BUNDLED_MINECRAFT_VERSION}-preview.json`),
        "utf8",
      ),
    ) as {
      minecraftVersion: string;
      sourceClientSha1: string;
      archiveSha256: string;
      fileCount: number;
    };
    expect(manifest).toMatchObject({
      minecraftVersion: BUNDLED_MINECRAFT_VERSION,
      sourceClientSha1: BUNDLED_MINECRAFT_CLIENT_SHA1,
    });
    expect(createHash("sha256").update(archiveBytes).digest("hex")).toBe(manifest.archiveSha256);
    expect(archiveBytes.byteLength).toBeLessThan(25 * 1024 * 1024);

    const archive = await JSZip.loadAsync(archiveBytes);
    const names = Object.keys(archive.files);
    expect(names.some((name) => name.startsWith("assets/minecraft/blockstates/"))).toBe(true);
    expect(names.some((name) => name.startsWith("assets/minecraft/models/block/"))).toBe(true);
    expect(names.some((name) => name.startsWith("assets/minecraft/textures/block/"))).toBe(true);
    expect(names.some((name) => name.startsWith("assets/minecraft/textures/colormap/"))).toBe(true);
    expect(names).toContain("preview-pack.json");
    expect(manifest.fileCount).toBeGreaterThan(4_000);
  });

  it("keeps the credited XKRD pack byte-for-byte unchanged", async () => {
    const archiveBytes = await readFile(path.resolve(process.cwd(), "public", XKRD_ARCHIVE_PATH));
    expect(createHash("sha256").update(archiveBytes).digest("hex")).toBe(XKRD_ARCHIVE_SHA256);

    const archive = await JSZip.loadAsync(archiveBytes);
    expect(archive.file("pack.mcmeta")).not.toBeNull();
    expect(archive.file("assets/minecraft/blockstates/scaffolding.json")).not.toBeNull();
    expect(archive.file("assets/create/blockstates/linear_chassis.json")).not.toBeNull();
  });
});

describe("loadMojangResources", () => {
  it("loads only requested jar entries, follows model parents, resolves aliases and atlases frame one", async () => {
    const textResources = new Map<string, string>([
      [
        "assets/minecraft/blockstates/test_block.json",
        json({ variants: { "facing=north": { model: "minecraft:block/test_child" } } }),
      ],
      [
        "assets/minecraft/models/block/test_child.json",
        json({
          parent: "minecraft:block/test_parent",
          textures: { base: "minecraft:block/animated" },
        }),
      ],
      [
        "assets/minecraft/models/block/test_parent.json",
        json({
          textures: { side: "#base" },
          elements: [
            {
              from: [0, 0, 0],
              to: [16, 16, 16],
              faces: { north: { texture: "#side" } },
            },
          ],
        }),
      ],
      ["assets/minecraft/textures/block/animated.png.mcmeta", json({ animation: {} })],
      [
        "assets/minecraft/blockstates/water.json",
        json({ variants: { "": { model: "block/water" } } }),
      ],
      ["assets/minecraft/models/block/water.json", json({})],
      ["assets/minecraft/textures/block/water_still.png.mcmeta", json({ animation: {} })],
      [
        "assets/minecraft/blockstates/missing_texture_block.json",
        json({ variants: { "": { model: "minecraft:block/missing_texture_block" } } }),
      ],
      [
        "assets/minecraft/models/block/missing_texture_block.json",
        json({
          textures: { all: "minecraft:block/not_in_archive" },
          elements: [
            {
              from: [0, 0, 0],
              to: [16, 16, 16],
              faces: { north: { texture: "#all" } },
            },
          ],
        }),
      ],
      ["assets/minecraft/blockstates/unrelated.json", json({ variants: {} })],
    ]);
    const byteResources = new Map<string, Uint8Array>([
      ["assets/minecraft/textures/block/animated.png", new Uint8Array([1])],
      ["assets/minecraft/textures/block/water_still.png", new Uint8Array([2])],
      ["assets/minecraft/textures/block/unrelated.png", new Uint8Array([99])],
    ]);
    const archive = new FakeArchive(textResources, byteResources);
    const drawCalls: DrawCall[] = [];
    const fakeContext = {
      imageSmoothingEnabled: true,
      drawImage(
        source: CanvasImageSource,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) {
        drawCalls.push({ source, sx, sy, sw, sh, dx, dy, dw, dh });
      },
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => fakeContext,
    } as unknown as HTMLCanvasElement;

    const vanilla = state("minecraft:test_block", { facing: "north" });
    const legacyState = state("minecraft:test_block", {
      facing: "sideways",
      removed_property: "true",
    });
    const water = state("minecraft:water", { level: "0" });
    const missingTexture = state("minecraft:missing_texture_block");
    const modded = state("example:machine");
    const result = await loadMojangResources({
      states: [vanilla, legacyState, water, missingTexture, modded],
      concurrency: 1,
      maxAtlasSize: 64,
      dependencies: {
        openArchive: () => Promise.resolve(archive),
        decodePng: (bytes): Promise<DecodedPng> =>
          Promise.resolve({
            source: { fakeTextureId: bytes[0] } as unknown as CanvasImageSource,
            width: 16,
            height: 48,
          }),
        createCanvas: () => fakeCanvas,
      },
    });

    expect(result.version).toBe(BUNDLED_MINECRAFT_VERSION);
    expect(result.sourceClientSha1).toBe(BUNDLED_MINECRAFT_CLIENT_SHA1);
    expect(result.archiveUrl).toBe(`/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`);
    expect(result.resolvedModels.has(vanilla.key)).toBe(true);
    expect(result.resolvedModels.has(legacyState.key)).toBe(true);
    expect(result.resolvedModels.has(water.key)).toBe(true);
    expect(result.textureLookup.has("block/animated")).toBe(true);
    expect(result.textureLookup.has("block/water_still")).toBe(true);
    expect(result.resolvedModels.has(missingTexture.key)).toBe(false);
    expect(result.fallbackStates.map((item) => item.key)).toEqual([missingTexture.key, modded.key]);
    expect(result.issues.some((issue) => issue.code === "UNSUPPORTED_NAMESPACE")).toBe(true);

    const resolvedFace = result.resolvedModels.get(vanilla.key)?.[0]?.elements?.[0]?.faces.north;
    expect(resolvedFace?.texture).toBe("minecraft:block/animated");
    const animatedDraw = drawCalls.find(
      (call) => (call.source as unknown as { fakeTextureId: number }).fakeTextureId === 1,
    );
    expect(animatedDraw).toMatchObject({ sx: 0, sy: 0, sw: 16, sh: 16, dw: 16, dh: 16 });

    expect(archive.reads).toContain("assets/minecraft/models/block/test_parent.json");
    expect(archive.reads).not.toContain("assets/minecraft/blockstates/unrelated.json");
    expect(archive.reads).not.toContain("assets/minecraft/textures/block/unrelated.png");
    expect(archive.maxActiveReads).toBe(1);
    expect(archive.closed).toBe(true);
  });

  it("uses exact XKRD states, supplements missing resources, and retries bad states in pure vanilla", async () => {
    const cubeModel = (texture: string, parent?: string) =>
      json({
        ...(parent === undefined ? {} : { parent }),
        textures: { all: texture },
        ...(parent === undefined
          ? {
              elements: [
                {
                  from: [0, 0, 0],
                  to: [16, 16, 16],
                  faces: { north: { texture: "#all" } },
                },
              ],
            }
          : {}),
      });
    const overlayText = new Map<string, string>([
      [
        "assets/minecraft/blockstates/test_block.json",
        json({ variants: { "powered=true": { model: "minecraft:block/xkrd_test" } } }),
      ],
      [
        "assets/minecraft/models/block/xkrd_test.json",
        cubeModel("minecraft:block/collision", "minecraft:block/shared_parent"),
      ],
      [
        "assets/minecraft/blockstates/indicator.json",
        json({ variants: { "powered=true": { model: "minecraft:block/xkrd_wrong_on" } } }),
      ],
      ["assets/minecraft/models/block/xkrd_wrong_on.json", cubeModel("minecraft:block/wrong_on")],
      [
        "assets/minecraft/blockstates/scaffolding.json",
        json({ variants: { "bottom=true,1": { model: "minecraft:block/xkrd_unstable" } } }),
      ],
      ["assets/minecraft/models/block/xkrd_unstable.json", cubeModel("minecraft:block/wrong")],
      [
        "assets/create/blockstates/linear_chassis.json",
        json({ variants: { "axis=x": { model: "create:block/chassis" } } }),
      ],
      ["assets/create/models/block/chassis.json", cubeModel("create:block/chassis")],
    ]);
    const overlayBytes = new Map<string, Uint8Array>([
      ["assets/minecraft/textures/block/collision.png", new Uint8Array([11])],
      ["assets/create/textures/block/chassis.png", new Uint8Array([12])],
    ]);
    const vanillaSharedText = new Map<string, string>([
      ["assets/minecraft/models/block/shared_parent.json", cubeModel("#all")],
    ]);
    const vanillaRetryText = new Map<string, string>([
      [
        "assets/minecraft/blockstates/scaffolding.json",
        json({
          variants: {
            "bottom=true,distance=6": { model: "minecraft:block/vanilla_scaffolding" },
          },
        }),
      ],
      [
        "assets/minecraft/models/block/vanilla_scaffolding.json",
        cubeModel("minecraft:block/collision"),
      ],
      [
        "assets/minecraft/blockstates/indicator.json",
        json({ variants: { "powered=false": { model: "minecraft:block/indicator_off" } } }),
      ],
      [
        "assets/minecraft/models/block/indicator_off.json",
        cubeModel("minecraft:block/indicator_off"),
      ],
    ]);
    const vanillaRetryBytes = new Map<string, Uint8Array>([
      ["assets/minecraft/textures/block/collision.png", new Uint8Array([21])],
      ["assets/minecraft/textures/block/indicator_off.png", new Uint8Array([22])],
    ]);
    const overlay = new FakeArchive(overlayText, overlayBytes);
    const vanillaForOverlay = new FakeArchive(vanillaSharedText, vanillaRetryBytes);
    const vanillaRetry = new FakeArchive(vanillaRetryText, vanillaRetryBytes);
    const openCalls: string[] = [];
    let vanillaOpenCount = 0;
    const fakeCanvas = () =>
      ({
        width: 0,
        height: 0,
        getContext: () => ({ imageSmoothingEnabled: true, drawImage: () => undefined }),
      }) as unknown as HTMLCanvasElement;
    const testBlock = state("minecraft:test_block", { powered: "true", facing: "north" });
    const unmatchedOverlay = state("minecraft:indicator", { powered: "false" });
    const malformedScaffolding = state("minecraft:scaffolding", {
      bottom: "true",
      distance: "6",
      waterlogged: "false",
    });
    const createBlock = state("create:linear_chassis", { axis: "x" });

    const result = await loadMojangResources({
      states: [testBlock, unmatchedOverlay, malformedScaffolding, createBlock],
      useXkrd: true,
      maxAtlasSize: 64,
      dependencies: {
        openArchive: (url) => {
          openCalls.push(url);
          if (url === `/${XKRD_ARCHIVE_PATH}`) return Promise.resolve(overlay);
          vanillaOpenCount += 1;
          return Promise.resolve(vanillaOpenCount === 1 ? vanillaForOverlay : vanillaRetry);
        },
        decodePng: (bytes): Promise<DecodedPng> =>
          Promise.resolve({
            source: { fakeTextureId: bytes[0] } as unknown as CanvasImageSource,
            width: 16,
            height: 16,
          }),
        createCanvas: fakeCanvas,
      },
    });

    expect(openCalls).toEqual([
      `/${XKRD_ARCHIVE_PATH}`,
      `/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`,
      `/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`,
    ]);
    expect(result.archiveUrl).toBe(`/${XKRD_ARCHIVE_PATH}`);
    expect(result.fallbackStates).toEqual([]);
    expect(result.resolvedModels.get(testBlock.key)?.[0]?.modelName).toBe(
      "minecraft:block/xkrd_test",
    );
    expect(result.resolvedModels.get(createBlock.key)?.[0]?.modelName).toBe("create:block/chassis");
    expect(result.resolvedModels.get(unmatchedOverlay.key)?.[0]?.modelName).toBe(
      "minecraft:block/indicator_off",
    );
    expect(result.resolvedModels.get(malformedScaffolding.key)?.[0]?.modelName).toBe(
      "minecraft:block/vanilla_scaffolding",
    );
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "BLOCKSTATE_INVALID" && issue.stateKey === malformedScaffolding.key,
      ),
    ).toBe(true);

    const overlayFace = result.resolvedModels.get(testBlock.key)?.[0]?.elements?.[0]?.faces.north;
    const retryFace = result.resolvedModels.get(malformedScaffolding.key)?.[0]?.elements?.[0]?.faces
      .north;
    expect(overlayFace?.texture).toBe("minecraft:block/collision");
    expect(retryFace?.texture).toBe("__vanilla_retry__/block/collision");
    expect(result.textureLookup.get("block/collision")?.atlasIndex).toBe(0);
    expect(result.textureLookup.get("__vanilla_retry__/block/collision")?.atlasIndex).toBe(1);
    expect(overlay.reads).not.toContain("assets/minecraft/models/block/xkrd_unstable.json");
    expect(overlay.closed).toBe(true);
    expect(vanillaForOverlay.closed).toBe(true);
    expect(vanillaRetry.closed).toBe(true);
  });

  it("uses pure vanilla when the optional XKRD archive cannot be opened", async () => {
    const textResources = new Map<string, string>([
      [
        "assets/minecraft/blockstates/resilient.json",
        json({ variants: { "": { model: "minecraft:block/resilient" } } }),
      ],
      [
        "assets/minecraft/models/block/resilient.json",
        json({
          textures: { all: "minecraft:block/resilient" },
          elements: [
            {
              from: [0, 0, 0],
              to: [16, 16, 16],
              faces: { north: { texture: "#all" } },
            },
          ],
        }),
      ],
    ]);
    const vanilla = new FakeArchive(
      textResources,
      new Map([["assets/minecraft/textures/block/resilient.png", new Uint8Array([31])]]),
    );
    const openCalls: string[] = [];
    const target = state("minecraft:resilient");

    const result = await loadMojangResources({
      states: [target],
      useXkrd: true,
      maxAtlasSize: 64,
      dependencies: {
        openArchive: (url) => {
          openCalls.push(url);
          return url === `/${XKRD_ARCHIVE_PATH}`
            ? Promise.reject(new Error("optional pack unavailable"))
            : Promise.resolve(vanilla);
        },
        decodePng: (bytes): Promise<DecodedPng> =>
          Promise.resolve({
            source: { fakeTextureId: bytes[0] } as unknown as CanvasImageSource,
            width: 16,
            height: 16,
          }),
        createCanvas: () =>
          ({
            width: 0,
            height: 0,
            getContext: () => ({ imageSmoothingEnabled: true, drawImage: () => undefined }),
          }) as unknown as HTMLCanvasElement,
      },
    });

    expect(openCalls).toEqual([`/${XKRD_ARCHIVE_PATH}`, `/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`]);
    expect(result.archiveUrl).toBe(`/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`);
    expect(result.resolvedModels.has(target.key)).toBe(true);
    expect(result.fallbackStates).toEqual([]);
    expect(vanilla.closed).toBe(true);
  });

  it("keeps resolved XKRD states when a later vanilla retry is unavailable", async () => {
    const overlay = new FakeArchive(
      new Map([
        [
          "assets/minecraft/blockstates/resilient.json",
          json({ variants: { "": { model: "minecraft:block/resilient" } } }),
        ],
        [
          "assets/minecraft/models/block/resilient.json",
          json({
            textures: { all: "minecraft:block/resilient" },
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { north: { texture: "#all" } },
              },
            ],
          }),
        ],
      ]),
      new Map([["assets/minecraft/textures/block/resilient.png", new Uint8Array([41])]]),
    );
    const vanillaForOverlay = new FakeArchive(new Map(), new Map());
    const openCalls: string[] = [];
    let vanillaOpenCount = 0;
    const target = state("minecraft:resilient");
    const unresolved = state("example:unresolved");

    const result = await loadMojangResources({
      states: [target, unresolved],
      useXkrd: true,
      maxAtlasSize: 64,
      dependencies: {
        openArchive: (url) => {
          openCalls.push(url);
          if (url === `/${XKRD_ARCHIVE_PATH}`) return Promise.resolve(overlay);
          vanillaOpenCount += 1;
          return vanillaOpenCount === 1
            ? Promise.resolve(vanillaForOverlay)
            : Promise.reject(new Error("vanilla retry unavailable"));
        },
        decodePng: (bytes): Promise<DecodedPng> =>
          Promise.resolve({
            source: { fakeTextureId: bytes[0] } as unknown as CanvasImageSource,
            width: 16,
            height: 16,
          }),
        createCanvas: () =>
          ({
            width: 0,
            height: 0,
            getContext: () => ({ imageSmoothingEnabled: true, drawImage: () => undefined }),
          }) as unknown as HTMLCanvasElement,
      },
    });

    expect(openCalls).toEqual([
      `/${XKRD_ARCHIVE_PATH}`,
      `/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`,
      `/${BUNDLED_MINECRAFT_ARCHIVE_PATH}`,
    ]);
    expect(result.archiveUrl).toBe(`/${XKRD_ARCHIVE_PATH}`);
    expect(result.resolvedModels.has(target.key)).toBe(true);
    expect(result.fallbackStates.map((item) => item.key)).toEqual([unresolved.key]);
    expect(overlay.closed).toBe(true);
    expect(vanillaForOverlay.closed).toBe(true);
  });
});
