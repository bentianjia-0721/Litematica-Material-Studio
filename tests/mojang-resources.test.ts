import { describe, expect, it } from "vitest";
import type { BlockState } from "../src/lib/litematic";
import {
  MOJANG_VERSION_MANIFEST_URL,
  animationFirstFrameRect,
  collectBlockStateModelReferences,
  loadMojangResources,
  normalizeMinecraftModelReference,
  normalizeMinecraftTextureReference,
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
    const water = state("minecraft:water", { level: "0" });
    const modded = state("example:machine");
    const result = await loadMojangResources({
      version: "Minecraft 1.21.5 (auto detected)",
      states: [vanilla, water, modded],
      concurrency: 1,
      maxAtlasSize: 64,
      dependencies: {
        fetchJson: (url) => {
          if (url === MOJANG_VERSION_MANIFEST_URL) {
            return Promise.resolve({
              versions: [{ id: "1.21.5", url: "https://meta.test/1.21.5.json" }],
            });
          }
          return Promise.resolve({
            downloads: {
              client: {
                url: "https://objects.test/client.jar",
                sha1: "0123456789abcdef0123456789abcdef01234567",
              },
            },
          });
        },
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

    expect(result.version).toBe("1.21.5");
    expect(result.clientSha1).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(result.resolvedModels.has(vanilla.key)).toBe(true);
    expect(result.resolvedModels.has(water.key)).toBe(true);
    expect(result.textureLookup.has("block/animated")).toBe(true);
    expect(result.textureLookup.has("block/water_still")).toBe(true);
    expect(result.fallbackStates.map((item) => item.key)).toEqual([modded.key]);
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
});
