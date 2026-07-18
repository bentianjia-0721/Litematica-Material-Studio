import { BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from "three";
import type { ResolvedBlockModel } from "mc-assets";
import type { BlockState } from "../../lib/litematic";

export type MinecraftAtlasKind = "latest" | "legacy";

/** Texture coordinates returned by mc-assets' AtlasParser. */
export interface MinecraftAtlasTexture {
  readonly u: number;
  readonly v: number;
  readonly su: number;
  readonly sv: number;
  readonly imageType: MinecraftAtlasKind;
}

export type MinecraftTextureLookup = (textureName: string) => MinecraftAtlasTexture | undefined;

export interface MinecraftAtlasGeometryGroups {
  readonly latest?: BufferGeometry;
  readonly legacy?: BufferGeometry;
}

export type MinecraftModelMissingReason = "missing-model" | "missing-elements" | "missing-textures";

export interface MinecraftModelMissingReport {
  readonly stateKey: string;
  readonly reason: MinecraftModelMissingReason;
  readonly missingTextureIds: readonly string[];
  readonly skippedFaceCount: number;
}

export interface MinecraftModelGeometryResult {
  /** Null means no honest vanilla geometry could be baked for this state. */
  readonly geometries: MinecraftAtlasGeometryGroups | null;
  readonly missing: MinecraftModelMissingReport | null;
  readonly faceCount: number;
}

type FaceDirection = "down" | "up" | "north" | "south" | "west" | "east";
type ModelPoint = readonly [number, number, number];
type ModelUv = readonly [number, number, number, number];

interface GeometryAccumulator {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly colors: number[];
  faceCount: number;
}

const directions = new Set<FaceDirection>(["down", "up", "north", "south", "west", "east"]);

const triangleCorners = [0, 1, 2, 0, 2, 3] as const;
const blockCenter = new Vector3(8, 8, 8);
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);

function createAccumulator(): GeometryAccumulator {
  return { positions: [], normals: [], uvs: [], colors: [], faceCount: 0 };
}

function isFaceDirection(value: string): value is FaceDirection {
  return directions.has(value as FaceDirection);
}

function normaliseBlockName(name: string): string {
  return name.toLocaleLowerCase().replace(/^minecraft:/, "");
}

function redstoneTint(powerValue: string | undefined): number {
  const parsedPower = Number.parseInt(powerValue ?? "0", 10);
  const power = Math.min(15, Math.max(0, Number.isFinite(parsedPower) ? parsedPower : 0));
  const strength = power / 15;
  const red = power === 0 ? 0.3 : strength * 0.6 + 0.4;
  const green = Math.max(0, strength * strength * 0.7 - 0.5);
  const blue = Math.max(0, strength * strength * 0.6 - 0.7);
  return (Math.round(red * 255) << 16) | (Math.round(green * 255) << 8) | Math.round(blue * 255);
}

/**
 * Produces stable, plains-biome-style tints for model faces carrying tintindex.
 * A biome-aware renderer can replace these later without rebuilding UVs/models.
 */
export function resolveMinecraftTintColor(state: BlockState, tintIndex: number): number {
  if (tintIndex < 0) return 0xffffff;

  const name = normaliseBlockName(state.name);
  if (name === "redstone_wire") return redstoneTint(state.properties.power);
  if (name === "water" || name === "flowing_water" || name === "bubble_column") {
    return 0x3f76e4;
  }
  if (name === "spruce_leaves") return 0x619961;
  if (name === "birch_leaves") return 0x80a755;
  if (name === "lily_pad") return 0x208030;
  if (
    name.endsWith("_stem") ||
    name === "attached_melon_stem" ||
    name === "attached_pumpkin_stem"
  ) {
    const parsedAge = Number.parseInt(state.properties.age ?? "7", 10);
    const age = Math.min(7, Math.max(0, Number.isFinite(parsedAge) ? parsedAge : 7));
    return ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4);
  }
  if (
    name.includes("leaves") ||
    name.includes("vine") ||
    name.includes("azalea") ||
    name === "mangrove_propagule"
  ) {
    return 0x77ab2f;
  }
  if (
    name.includes("grass") ||
    name.includes("fern") ||
    name.includes("bush") ||
    name === "sugar_cane"
  ) {
    return 0x91bd59;
  }

  return 0xffffff;
}

function textureCandidates(textureName: string): readonly string[] {
  const withoutNamespace = textureName.replace(/^minecraft:/, "");
  const withoutTextures = withoutNamespace.replace(/^textures\//, "");
  const withoutBlockFolder = withoutTextures.replace(/^blocks?\//, "");
  return [...new Set([textureName, withoutNamespace, withoutTextures, withoutBlockFolder])];
}

function resolveFaceTexture(
  faceTexture: string,
  textures: ResolvedBlockModel["textures"],
): string | null {
  let current = faceTexture;
  const visited = new Set<string>();

  while (current.startsWith("#")) {
    const key = current.slice(1);
    if (visited.has(key)) return null;
    visited.add(key);
    const next = textures?.[key];
    if (!next) return null;
    current = next;
  }

  return current || null;
}

function lookupTexture(
  textureName: string,
  getTexture: MinecraftTextureLookup,
): MinecraftAtlasTexture | undefined {
  for (const candidate of textureCandidates(textureName)) {
    const found = getTexture(candidate);
    if (found) return found;
  }
  return undefined;
}

function defaultFaceUv(direction: FaceDirection, from: ModelPoint, to: ModelPoint): ModelUv {
  switch (direction) {
    case "north":
      return [to[0], 16 - to[1], from[0], 16 - from[1]];
    case "east":
    case "west":
      return [from[2], 16 - to[1], to[2], 16 - from[1]];
    case "south":
      return [from[0], 16 - to[1], to[0], 16 - from[1]];
    case "up":
      return [from[0], from[2], to[0], to[2]];
    case "down":
      return [to[0], from[2], from[0], to[2]];
  }
}

/** Quad corners are bottom-left, bottom-right, top-right, top-left from outside. */
function faceVertices(direction: FaceDirection, from: ModelPoint, to: ModelPoint): Vector3[] {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;

  switch (direction) {
    case "north":
      return [
        new Vector3(x1, y0, z0),
        new Vector3(x0, y0, z0),
        new Vector3(x0, y1, z0),
        new Vector3(x1, y1, z0),
      ];
    case "south":
      return [
        new Vector3(x0, y0, z1),
        new Vector3(x1, y0, z1),
        new Vector3(x1, y1, z1),
        new Vector3(x0, y1, z1),
      ];
    case "west":
      return [
        new Vector3(x0, y0, z0),
        new Vector3(x0, y0, z1),
        new Vector3(x0, y1, z1),
        new Vector3(x0, y1, z0),
      ];
    case "east":
      return [
        new Vector3(x1, y0, z1),
        new Vector3(x1, y0, z0),
        new Vector3(x1, y1, z0),
        new Vector3(x1, y1, z1),
      ];
    case "up":
      return [
        new Vector3(x0, y1, z1),
        new Vector3(x1, y1, z1),
        new Vector3(x1, y1, z0),
        new Vector3(x0, y1, z0),
      ];
    case "down":
      return [
        new Vector3(x0, y0, z0),
        new Vector3(x1, y0, z0),
        new Vector3(x1, y0, z1),
        new Vector3(x0, y0, z1),
      ];
  }
}

function rotationAxis(axis: string): Vector3 | null {
  if (axis === "x") return xAxis;
  if (axis === "y") return yAxis;
  if (axis === "z") return zAxis;
  return null;
}

function applyElementRotation(
  point: Vector3,
  rotation: NonNullable<NonNullable<ResolvedBlockModel["elements"]>[number]["rotation"]>,
): void {
  const axis = rotationAxis(rotation.axis);
  if (!axis) return;

  const origin = new Vector3(...rotation.origin);
  point.sub(origin);

  if (rotation.rescale) {
    const cosine = Math.cos(MathUtils.degToRad(Math.abs(rotation.angle)));
    const scale = Math.abs(cosine) > 1e-6 ? 1 / Math.abs(cosine) : 1;
    if (rotation.axis !== "x") point.x *= scale;
    if (rotation.axis !== "y") point.y *= scale;
    if (rotation.axis !== "z") point.z *= scale;
  }

  point.applyAxisAngle(axis, MathUtils.degToRad(rotation.angle)).add(origin);
}

function applyBlockStateRotation(point: Vector3, model: ResolvedBlockModel): void {
  // Minecraft blockstate rotations are clockwise. Three's positive rotations
  // are counter-clockwise, so y=90 must turn north (-Z) into east (+X).
  if (model.x) point.applyAxisAngle(xAxis, MathUtils.degToRad(-model.x));
  if (model.y) point.applyAxisAngle(yAxis, MathUtils.degToRad(-model.y));
  if (model.z) point.applyAxisAngle(zAxis, MathUtils.degToRad(-model.z));
}

function transformVertices(
  vertices: Vector3[],
  elementRotation: NonNullable<ResolvedBlockModel["elements"]>[number]["rotation"],
  model: ResolvedBlockModel,
): Vector3[] {
  return vertices.map((vertex) => {
    if (elementRotation) applyElementRotation(vertex, elementRotation);
    vertex.sub(blockCenter).multiplyScalar(1 / 16);
    applyBlockStateRotation(vertex, model);
    return vertex;
  });
}

function rotatedUvs(
  uv: ModelUv,
  faceRotation: number | undefined,
  texture: MinecraftAtlasTexture,
): readonly (readonly [number, number])[] {
  const [u1, v1, u2, v2] = uv;
  const sourceCorners: readonly (readonly [number, number])[] = [
    [u1, v2],
    [u2, v2],
    [u2, v1],
    [u1, v1],
  ];
  const turns = ((Math.round((faceRotation ?? 0) / 90) % 4) + 4) % 4;

  return sourceCorners.map((_, index) => {
    const source = sourceCorners[(index + turns) % 4] ?? sourceCorners[0]!;
    const atlasU = texture.u + (source[0] / 16) * texture.su;
    const atlasTopV = texture.v + (source[1] / 16) * texture.sv;
    return [atlasU, 1 - atlasTopV] as const;
  });
}

function appendFace(
  accumulator: GeometryAccumulator,
  vertices: readonly Vector3[],
  uvs: readonly (readonly [number, number])[],
  tint: number,
): void {
  const first = vertices[0];
  const second = vertices[1];
  const third = vertices[2];
  if (!first || !second || !third) return;

  const normal = new Vector3()
    .subVectors(second, first)
    .cross(new Vector3().subVectors(third, first))
    .normalize();
  const color = new Color(tint);

  for (const corner of triangleCorners) {
    const vertex = vertices[corner];
    const uv = uvs[corner];
    if (!vertex || !uv) continue;
    accumulator.positions.push(vertex.x, vertex.y, vertex.z);
    accumulator.normals.push(normal.x, normal.y, normal.z);
    accumulator.uvs.push(uv[0], uv[1]);
    accumulator.colors.push(color.r, color.g, color.b);
  }
  accumulator.faceCount += 1;
}

function accumulatorGeometry(
  accumulator: GeometryAccumulator,
  atlasKind: MinecraftAtlasKind,
  state: BlockState,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(accumulator.positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(accumulator.normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(accumulator.uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(accumulator.colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    atlasKind,
    blockStateKey: state.key,
    faceCount: accumulator.faceCount,
  };
  return geometry;
}

function fluidModel(state: BlockState): ResolvedBlockModel | null {
  const name = normaliseBlockName(state.name);
  const isWater = name === "water" || name === "flowing_water" || name === "bubble_column";
  const isLava = name === "lava" || name === "flowing_lava";
  if (!isWater && !isLava) return null;

  const texture = isWater ? "block/water_still" : "block/lava_still";
  const tint = isWater ? { tintindex: 0 } : {};
  return {
    modelName: `generated-fluid/${name}`,
    textures: { all: texture },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          down: { texture, ...tint },
          up: { texture, ...tint },
          north: { texture, ...tint },
          south: { texture, ...tint },
          west: { texture, ...tint },
          east: { texture, ...tint },
        },
      },
    ],
  };
}

/**
 * Bakes all resolved multipart models for one blockstate into atlas-specific,
 * non-indexed BufferGeometry. Atlas v coordinates are converted from mc-assets'
 * top-left convention to Three's bottom-left UV convention.
 */
export function bakeMinecraftModelGeometry(
  state: BlockState,
  resolvedModels: readonly ResolvedBlockModel[] | null | undefined,
  getTexture: MinecraftTextureLookup,
): MinecraftModelGeometryResult {
  const suppliedModels = resolvedModels ?? [];
  const hasSuppliedElements = suppliedModels.some((model) => (model.elements?.length ?? 0) > 0);
  const generatedFluid = hasSuppliedElements ? null : fluidModel(state);
  const models: readonly ResolvedBlockModel[] = hasSuppliedElements
    ? suppliedModels
    : generatedFluid
      ? [generatedFluid]
      : [];

  if (models.length === 0) {
    return {
      geometries: null,
      missing: {
        stateKey: state.key,
        reason: suppliedModels.length > 0 ? "missing-elements" : "missing-model",
        missingTextureIds: [],
        skippedFaceCount: 0,
      },
      faceCount: 0,
    };
  }

  const accumulators: Record<MinecraftAtlasKind, GeometryAccumulator> = {
    latest: createAccumulator(),
    legacy: createAccumulator(),
  };
  const missingTextures = new Set<string>();
  let skippedFaceCount = 0;

  for (const model of models) {
    for (const element of model.elements ?? []) {
      for (const [faceName, face] of Object.entries(element.faces)) {
        if (!isFaceDirection(faceName)) {
          skippedFaceCount += 1;
          continue;
        }

        const textureName = resolveFaceTexture(face.texture, model.textures);
        if (!textureName) {
          missingTextures.add(face.texture);
          skippedFaceCount += 1;
          continue;
        }
        const texture = lookupTexture(textureName, getTexture);
        if (!texture) {
          missingTextures.add(textureName);
          skippedFaceCount += 1;
          continue;
        }

        const sourceUv =
          face.uv && face.uv.length >= 4
            ? ([face.uv[0]!, face.uv[1]!, face.uv[2]!, face.uv[3]!] as const)
            : defaultFaceUv(faceName, element.from, element.to);
        const vertices = transformVertices(
          faceVertices(faceName, element.from, element.to),
          element.rotation,
          model,
        );
        const tint =
          face.tintindex === undefined
            ? 0xffffff
            : resolveMinecraftTintColor(state, face.tintindex);
        appendFace(
          accumulators[texture.imageType],
          vertices,
          rotatedUvs(sourceUv, face.rotation, texture),
          tint,
        );
      }
    }
  }

  const groups: { latest?: BufferGeometry; legacy?: BufferGeometry } = {};
  if (accumulators.latest.faceCount > 0) {
    groups.latest = accumulatorGeometry(accumulators.latest, "latest", state);
  }
  if (accumulators.legacy.faceCount > 0) {
    groups.legacy = accumulatorGeometry(accumulators.legacy, "legacy", state);
  }
  const faceCount = accumulators.latest.faceCount + accumulators.legacy.faceCount;
  const geometries = faceCount > 0 ? groups : null;

  let missing: MinecraftModelMissingReport | null = null;
  if (missingTextures.size > 0) {
    missing = {
      stateKey: state.key,
      reason: "missing-textures",
      missingTextureIds: [...missingTextures].sort(),
      skippedFaceCount,
    };
  } else if (!geometries) {
    missing = {
      stateKey: state.key,
      reason: "missing-elements",
      missingTextureIds: [],
      skippedFaceCount,
    };
  }

  return { geometries, missing, faceCount };
}
