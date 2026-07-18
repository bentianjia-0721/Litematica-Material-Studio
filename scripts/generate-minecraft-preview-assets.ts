import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip, { type JSZipObject } from "jszip";

const VERSION = "1.21.11";
const CLIENT_SHA1 = "ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd";
const CLIENT_URL =
  "https://piston-data.mojang.com/v1/objects/ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd/client.jar";
const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), "public/minecraft-assets");
const OUTPUT_ARCHIVE = path.join(OUTPUT_DIRECTORY, `minecraft-${VERSION}-preview.zip`);
const OUTPUT_MANIFEST = path.join(OUTPUT_DIRECTORY, `minecraft-${VERSION}-preview.json`);
const CACHED_CLIENT = path.join(os.tmpdir(), `minecraft-${VERSION}-${CLIENT_SHA1}-client.jar`);

interface PreviewPackManifest {
  readonly schemaVersion: 1;
  readonly minecraftVersion: typeof VERSION;
  readonly sourceClientSha1: typeof CLIENT_SHA1;
  readonly sourceClientUrl: typeof CLIENT_URL;
  readonly archiveSha256?: string;
  readonly fileCount: number;
  readonly includedRoots: readonly string[];
}

function digest(algorithm: "sha1" | "sha256", bytes: Uint8Array): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

async function downloadClient(): Promise<Buffer> {
  try {
    const cached = await readFile(CACHED_CLIENT);
    if (digest("sha1", cached) === CLIENT_SHA1) return cached;
  } catch {
    // A missing or stale temporary cache is replaced below.
  }

  const response = await fetch(CLIENT_URL);
  if (!response.ok) {
    throw new Error(
      `Minecraft ${VERSION} client download failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha1 = digest("sha1", bytes);
  if (actualSha1 !== CLIENT_SHA1) {
    throw new Error(`Minecraft client SHA-1 mismatch: expected ${CLIENT_SHA1}, got ${actualSha1}`);
  }
  await writeFile(CACHED_CLIENT, bytes);
  return bytes;
}

function isBasePreviewResource(name: string): boolean {
  return (
    /^assets\/minecraft\/blockstates\/[^/]+\.json$/.test(name) ||
    /^assets\/minecraft\/models\/block\/.+\.json$/.test(name) ||
    /^assets\/minecraft\/textures\/block\/.+\.(?:png|png\.mcmeta)$/.test(name) ||
    /^assets\/minecraft\/textures\/colormap\/.+\.png$/.test(name)
  );
}

function normalizeTextureReference(reference: string): string | null {
  if (reference.startsWith("#")) return null;
  const separator = reference.indexOf(":");
  const namespace = separator >= 0 ? reference.slice(0, separator) : "minecraft";
  const resourcePath = separator >= 0 ? reference.slice(separator + 1) : reference;
  if (namespace !== "minecraft" || !resourcePath.startsWith("item/")) return null;
  if (resourcePath.includes("..") || !/^[a-z0-9_./-]+$/.test(resourcePath)) return null;
  return resourcePath;
}

function collectTextureReferences(value: unknown, output: Set<string>, key = ""): void {
  if (typeof value === "string") {
    if (key === "texture" || key === "textures") {
      const texture = normalizeTextureReference(value);
      if (texture !== null) output.add(texture);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectTextureReferences(entry, output, key);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (childKey === "textures" && typeof child === "object" && child !== null) {
      for (const texture of Object.values(child as Record<string, unknown>))
        collectTextureReferences(texture, output, "textures");
    } else {
      collectTextureReferences(child, output, childKey);
    }
  }
}

async function referencedItemTextures(
  source: JSZip,
  blockModels: readonly JSZipObject[],
): Promise<Set<string>> {
  const textures = new Set<string>();
  for (const model of blockModels) {
    const parsed = JSON.parse(await model.async("text")) as unknown;
    collectTextureReferences(parsed, textures);
  }
  const available = new Set(Object.keys(source.files));
  return new Set(
    [...textures].filter((texture) => available.has(`assets/minecraft/textures/${texture}.png`)),
  );
}

async function main(): Promise<void> {
  const client = await downloadClient();
  const source = await JSZip.loadAsync(client, { checkCRC32: true });
  const sourceEntries = Object.values(source.files).filter((entry) => !entry.dir);
  const blockModels = sourceEntries.filter((entry) =>
    /^assets\/minecraft\/models\/block\/.+\.json$/.test(entry.name),
  );
  const itemTextures = await referencedItemTextures(source, blockModels);
  const selectedNames = new Set(
    sourceEntries.filter((entry) => isBasePreviewResource(entry.name)).map((entry) => entry.name),
  );
  for (const texture of itemTextures) {
    selectedNames.add(`assets/minecraft/textures/${texture}.png`);
    const metadata = `assets/minecraft/textures/${texture}.png.mcmeta`;
    if (source.files[metadata] !== undefined) selectedNames.add(metadata);
  }

  const archive = new JSZip();
  const sortedNames = [...selectedNames].sort();
  for (const name of sortedNames) {
    const entry = source.files[name];
    if (entry === undefined || entry.dir) throw new Error(`Missing selected client entry: ${name}`);
    archive.file(name, await entry.async("uint8array"), {
      binary: true,
      createFolders: false,
      date: FIXED_DATE,
      unixPermissions: 0o100644,
    });
  }

  const embeddedManifest: PreviewPackManifest = {
    schemaVersion: 1,
    minecraftVersion: VERSION,
    sourceClientSha1: CLIENT_SHA1,
    sourceClientUrl: CLIENT_URL,
    fileCount: sortedNames.length,
    includedRoots: [
      "assets/minecraft/blockstates",
      "assets/minecraft/models/block",
      "assets/minecraft/textures/block",
      "assets/minecraft/textures/colormap",
      "model-referenced assets/minecraft/textures/item",
    ],
  };
  archive.file("preview-pack.json", `${JSON.stringify(embeddedManifest)}\n`, {
    createFolders: false,
    date: FIXED_DATE,
    unixPermissions: 0o100644,
  });
  archive.file(
    "NOTICE.txt",
    [
      "Contains a minimal Minecraft 1.21.11 preview-resource subset.",
      "Minecraft assets are owned by Mojang Studios / Microsoft.",
      "This unofficial project is not approved by or associated with Mojang or Microsoft.",
      "https://www.minecraft.net/usage-guidelines",
      "",
    ].join("\n"),
    { createFolders: false, date: FIXED_DATE, unixPermissions: 0o100644 },
  );

  const output = await archive.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    streamFiles: true,
  });
  const sidecar: PreviewPackManifest = {
    ...embeddedManifest,
    archiveSha256: digest("sha256", output),
  };
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await writeFile(OUTPUT_ARCHIVE, output);
  await writeFile(OUTPUT_MANIFEST, `${JSON.stringify(sidecar, null, 2)}\n`);
  process.stdout.write(
    `Generated ${path.relative(process.cwd(), OUTPUT_ARCHIVE)} (${output.length} bytes, ${sortedNames.length} source files, SHA-256 ${sidecar.archiveSha256})\n`,
  );
}

await main();
