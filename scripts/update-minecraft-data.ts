import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const minecraftDataFactory = require("minecraft-data") as MinecraftDataFactory;
const packageJson = JSON.parse(
  await readFile(require.resolve("minecraft-data/package.json"), "utf8"),
) as { version: string };

interface RawItem {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
}

interface RawDrop {
  drop?: number | { id?: number };
}

interface RawBlock {
  id: number;
  name: string;
  displayName: string;
  minStateId?: number;
  maxStateId?: number;
  variations?: Array<{ metadata: number; displayName?: string }>;
  drops?: Array<number | RawDrop>;
}

interface RawVersion {
  minecraftVersion: string;
  dataVersion: number;
  version: number;
  majorVersion: string;
  releaseType?: string;
}

interface RawMinecraftData {
  version: {
    minecraftVersion: string;
    dataVersion: number;
    version: number;
  };
  itemsArray: RawItem[];
  items: Record<number, RawItem>;
  itemsByName: Record<string, RawItem>;
  blocksArray: RawBlock[];
  language?: Record<string, string>;
}

interface MinecraftDataFactory {
  (version: string): RawMinecraftData | null;
  supportedVersions: { pc: string[] };
  versions: { pc: RawVersion[] };
}

const TARGET_VERSIONS = [
  "1.12.2",
  "1.13.2",
  "1.14.4",
  "1.15.2",
  "1.16.5",
  "1.17.1",
  "1.18.2",
  "1.19.2",
  "1.19.4",
  "1.20.1",
  "1.20.4",
  "1.20.6",
  "1.21.1",
  "1.21.4",
  "1.21.5",
  "1.21.8",
  "1.21.11",
] as const;

const OUTPUT_ROOT = path.resolve(process.cwd(), "src/data/minecraft");
const JAVA_ROOT = path.join(OUTPUT_ROOT, "java");
const REPORT_ROOT = path.join(OUTPUT_ROOT, "reports");
const ICON_ROOT = path.resolve(process.cwd(), "public/minecraft-icons");
const DATA_SOURCE = `PrismarineJS/minecraft-data@${packageJson.version}`;
const ICON_DATA_SOURCE = "Minecraft Wiki Invicon library";
const SOURCE_URLS = [
  "https://github.com/PrismarineJS/minecraft-data",
  `https://www.npmjs.com/package/minecraft-data/v/${packageJson.version}`,
];
const MOJANG_VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const WIKI_API_URL = "https://minecraft.wiki/api.php";
const ICON_SOURCE_URLS = [
  "https://minecraft.wiki/w/Template:Inventory_slot",
  "https://minecraft.wiki/w/Template:License_Mojang",
  WIKI_API_URL,
];

const iconFiles = new Map<string, Buffer>();
const usedIconFiles = new Set<string>();

interface GeneratedIcon {
  iconPath: string;
  iconSourceVersion: string;
}

interface WikiImageInfo {
  url: string;
  descriptionurl: string;
  mime: string;
  width: number;
  height: number;
}

interface WikiPage {
  title: string;
  missing?: boolean;
  imageinfo?: WikiImageInfo[];
}

interface WikiQueryResponse {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: WikiPage[];
  };
}

interface WikiIconSource {
  fileTitle: string;
  imageUrl: string;
  descriptionUrl: string;
  mime: string;
  width: number;
  height: number;
}

function iconExtension(mime: string): "png" | "gif" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  return null;
}

function storeIcon(bytes: Buffer, mime: string): GeneratedIcon | null {
  const extension = iconExtension(mime);
  if (!bytes.length || !extension) return null;
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  const fileName = `${hash}.${extension}`;
  usedIconFiles.add(fileName);
  if (!iconFiles.has(fileName)) iconFiles.set(fileName, bytes);
  return {
    iconPath: `/minecraft-icons/${fileName}`,
    iconSourceVersion: "Minecraft Wiki",
  };
}

async function writeIcons() {
  await mkdir(ICON_ROOT, { recursive: true });
  for (const [fileName, bytes] of iconFiles) {
    await writeFile(path.join(ICON_ROOT, fileName), bytes);
  }
  for (const fileName of await readdir(ICON_ROOT)) {
    if (/\.(?:png|gif)$/u.test(fileName) && !usedIconFiles.has(fileName)) {
      await unlink(path.join(ICON_ROOT, fileName));
    }
  }
}

interface OfficialLocalization {
  translations: Record<string, string>;
  sourceUrls: string[];
}

interface VersionManifest {
  versions: Array<{ id: string; url: string }>;
}

interface MojangVersionMetadata {
  assetIndex: { url: string };
}

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}

const stableZhCnNames: Record<string, string> = {
  air: "空气",
  stone: "石头",
  granite: "花岗岩",
  polished_granite: "磨制花岗岩",
  diorite: "闪长岩",
  andesite: "安山岩",
  grass_block: "草方块",
  dirt: "泥土",
  cobblestone: "圆石",
  sand: "沙子",
  gravel: "沙砾",
  glass: "玻璃",
  oak_planks: "橡木木板",
  spruce_planks: "云杉木板",
  birch_planks: "白桦木板",
  jungle_planks: "丛林木板",
  acacia_planks: "金合欢木板",
  dark_oak_planks: "深色橡木木板",
  redstone: "红石粉",
  torch: "火把",
  soul_torch: "灵魂火把",
  water_bucket: "水桶",
  lava_bucket: "熔岩桶",
  snow: "雪",
  oak_door: "橡木门",
  iron_door: "铁门",
  white_bed: "白色床",
  red_bed: "红色床",
  sunflower: "向日葵",
  lilac: "丁香",
  rose_bush: "玫瑰丛",
  peony: "牡丹",
  tall_grass: "高草丛",
  large_fern: "大型蕨",
  candle: "蜡烛",
  sea_pickle: "海泡菜",
  stone_slab: "石台阶",
  oak_slab: "橡木台阶",
  oak_sign: "橡木告示牌",
  oak_hanging_sign: "悬挂式橡木告示牌",
  white_banner: "白色旗帜",
  skeleton_skull: "骷髅头颅",
  player_head: "玩家头颅",
  ender_pearl: "末影珍珠",
  egg: "鸡蛋",
  bucket: "铁桶",
};

const explicitBlockItemAliases: Record<string, string> = {
  redstone_wire: "redstone",
  tripwire: "string",
  water: "water_bucket",
  flowing_water: "water_bucket",
  lava: "lava_bucket",
  flowing_lava: "lava_bucket",
  snow_layer: "snow",
  standing_sign: "sign",
  wall_sign: "sign",
  standing_banner: "banner",
  wall_banner: "banner",
  lit_redstone_ore: "redstone_ore",
  lit_redstone_lamp: "redstone_lamp",
  unlit_redstone_torch: "redstone_torch",
  powered_repeater: "repeater",
  unpowered_repeater: "repeater",
  powered_comparator: "comparator",
  unpowered_comparator: "comparator",
  double_stone_slab: "stone_slab",
  double_wooden_slab: "wooden_slab",
};

function namespaced(name: string): string {
  return name.includes(":") ? name : `minecraft:${name}`;
}

function firstDropId(block: RawBlock): number | null {
  for (const entry of block.drops ?? []) {
    if (typeof entry === "number") return entry;
    if (typeof entry.drop === "number") return entry.drop;
    if (entry.drop && typeof entry.drop.id === "number") return entry.drop.id;
  }
  return null;
}

function wallVariantItemName(blockName: string): string | null {
  if (blockName === "wall_torch") return "torch";
  if (blockName === "soul_wall_torch") return "soul_torch";
  if (blockName.endsWith("_wall_torch")) return blockName.replace("_wall_torch", "_torch");
  if (blockName.endsWith("_wall_hanging_sign")) {
    return blockName.replace("_wall_hanging_sign", "_hanging_sign");
  }
  if (blockName.endsWith("_wall_sign")) return blockName.replace("_wall_sign", "_sign");
  if (blockName.endsWith("_wall_banner")) return blockName.replace("_wall_banner", "_banner");
  if (blockName.endsWith("_wall_head")) return blockName.replace("_wall_head", "_head");
  if (blockName.endsWith("_wall_skull")) return blockName.replace("_wall_skull", "_skull");
  if (blockName.endsWith("_wall_fan")) return blockName.replace("_wall_fan", "_fan");
  return null;
}

function resolveBlockItemName(block: RawBlock, data: RawMinecraftData): string | null {
  const direct = explicitBlockItemAliases[block.name] ?? wallVariantItemName(block.name);
  if (direct && data.itemsByName[direct]) return direct;
  if (data.itemsByName[block.name]) return block.name;
  const dropId = firstDropId(block);
  return dropId === null ? null : (data.items[dropId]?.name ?? null);
}

async function request(url: string, attempt = 1): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Litematica-Material-Studio/1.0 (local data maintenance; contact 1262543771@qq.com)",
    },
  });
  if (response.ok) return response;
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    return request(url, attempt + 1);
  }
  throw new Error(`${url} returned HTTP ${response.status}`);
}

function resolveWikiTitle(title: string, aliases: Map<string, string>): string {
  let resolved = title;
  const visited = new Set<string>();
  while (aliases.has(resolved) && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = aliases.get(resolved) ?? resolved;
  }
  return resolved;
}

async function queryWikiIconSources(displayNames: string[]): Promise<Map<string, WikiIconSource>> {
  const sources = new Map<string, WikiIconSource>();
  const batchSize = 20;
  for (let offset = 0; offset < displayNames.length; offset += batchSize) {
    const batch = displayNames.slice(offset, offset + batchSize);
    const requestedTitles = batch.flatMap((name) => [
      `File:Invicon ${name}.png`,
      `File:Invicon ${name}.gif`,
    ]);
    const url = new URL(WIKI_API_URL);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|mime|size");
    url.searchParams.set("titles", requestedTitles.join("|"));
    const response = (await (await request(url.toString())).json()) as WikiQueryResponse;
    const aliases = new Map<string, string>();
    for (const entry of response.query?.normalized ?? []) aliases.set(entry.from, entry.to);
    for (const entry of response.query?.redirects ?? []) aliases.set(entry.from, entry.to);
    const pages = new Map(
      (response.query?.pages ?? [])
        .filter((page) => !page.missing && page.imageinfo?.[0])
        .map((page) => [page.title, page]),
    );

    for (const displayName of batch) {
      const candidates = [`File:Invicon ${displayName}.png`, `File:Invicon ${displayName}.gif`];
      for (const candidate of candidates) {
        const page = pages.get(resolveWikiTitle(candidate, aliases));
        const info = page?.imageinfo?.[0];
        if (!page || !info || !iconExtension(info.mime)) continue;
        sources.set(displayName, {
          fileTitle: page.title,
          imageUrl: info.url,
          descriptionUrl: info.descriptionurl,
          mime: info.mime,
          width: info.width,
          height: info.height,
        });
        break;
      }
    }
  }
  return sources;
}

async function loadWikiIcons(displayNames: string[]): Promise<{
  icons: Map<string, GeneratedIcon>;
  sources: Map<string, WikiIconSource>;
  warnings: string[];
}> {
  const uniqueNames = [...new Set(displayNames.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const sources = await queryWikiIconSources(uniqueNames);
  const icons = new Map<string, GeneratedIcon>();
  const warnings: string[] = [];
  const downloads = new Map<string, { source: WikiIconSource; names: string[] }>();
  for (const [displayName, source] of sources) {
    const existing = downloads.get(source.imageUrl);
    if (existing) existing.names.push(displayName);
    else downloads.set(source.imageUrl, { source, names: [displayName] });
  }

  const queue = [...downloads.values()];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < queue.length) {
      const entry = queue[nextIndex++];
      if (!entry) continue;
      try {
        const bytes = Buffer.from(await (await request(entry.source.imageUrl)).arrayBuffer());
        const icon = storeIcon(bytes, entry.source.mime);
        if (!icon) throw new Error(`unsupported or empty ${entry.source.mime} file`);
        for (const name of entry.names) icons.set(name, icon);
      } catch (error) {
        warnings.push(
          `${entry.source.fileTitle}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  return { icons, sources, warnings };
}

function parseLegacyLanguage(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return result;
}

async function loadOfficialLocalizations(
  versions: readonly string[],
): Promise<{ data: Map<string, OfficialLocalization>; warnings: string[] }> {
  const data = new Map<string, OfficialLocalization>();
  const warnings: string[] = [];
  let manifest: VersionManifest;
  try {
    manifest = (await (await request(MOJANG_VERSION_MANIFEST)).json()) as VersionManifest;
  } catch (error) {
    warnings.push(
      `Mojang version manifest unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { data, warnings };
  }
  const byId = new Map(manifest.versions.map((entry) => [entry.id, entry]));
  for (const version of versions) {
    try {
      const manifestEntry = byId.get(version);
      if (!manifestEntry) throw new Error("version is absent from Mojang's manifest");
      const metadata = (await (await request(manifestEntry.url)).json()) as MojangVersionMetadata;
      const assetIndex = (await (await request(metadata.assetIndex.url)).json()) as AssetIndex;
      const languagePath = assetIndex.objects["minecraft/lang/zh_cn.json"]
        ? "minecraft/lang/zh_cn.json"
        : "minecraft/lang/zh_cn.lang";
      const languageAsset = assetIndex.objects[languagePath];
      if (!languageAsset) throw new Error("zh_cn language asset is absent");
      const resourceUrl = `https://resources.download.minecraft.net/${languageAsset.hash.slice(0, 2)}/${languageAsset.hash}`;
      const text = await (await request(resourceUrl)).text();
      data.set(version, {
        translations: languagePath.endsWith(".json")
          ? (JSON.parse(text) as Record<string, string>)
          : parseLegacyLanguage(text),
        sourceUrls: [manifestEntry.url, metadata.assetIndex.url, resourceUrl],
      });
    } catch (error) {
      warnings.push(
        `${version} zh-CN unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { data, warnings };
}

function englishTranslationKeys(data: RawMinecraftData): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [key, value] of Object.entries(data.language ?? {})) {
    const normalized = value.trim().toLocaleLowerCase("en-US");
    const keys = result.get(normalized) ?? [];
    keys.push(key);
    result.set(normalized, keys);
  }
  return result;
}

function resolveZhCnName(
  item: RawItem,
  localization: OfficialLocalization | undefined,
  englishKeys: Map<string, string[]>,
): { name?: string; official: boolean } {
  if (localization) {
    const directKeys = [`item.minecraft.${item.name}`, `block.minecraft.${item.name}`];
    const matchingEnglishKeys =
      englishKeys.get(item.displayName.trim().toLocaleLowerCase("en-US")) ?? [];
    for (const key of [...directKeys, ...matchingEnglishKeys]) {
      const name = localization.translations[key];
      if (name) return { name, official: true };
    }
  }
  const curated = stableZhCnNames[item.name];
  return curated ? { name: curated, official: false } : { official: false };
}

async function generateVersion(
  version: string,
  generatedAt: string,
  localization: OfficialLocalization | undefined,
  wikiIcons: Map<string, GeneratedIcon>,
  wikiIconSources: Map<string, WikiIconSource>,
) {
  if (!minecraftDataFactory.supportedVersions.pc.includes(version)) {
    throw new Error(
      `minecraft-data ${packageJson.version} does not provide exact data for ${version}`,
    );
  }
  const data = minecraftDataFactory(version);
  if (!data || data.version.minecraftVersion !== version) {
    throw new Error(
      `minecraft-data returned ${data?.version.minecraftVersion ?? "nothing"} for ${version}; refusing an alias`,
    );
  }
  const items: Record<string, Record<string, unknown>> = {};
  const blocks: Record<string, Record<string, unknown>> = {};
  const blockToItem: Record<string, string> = {};
  const legacyBlockIds: Record<string, string> = {};
  const blockNamesByItem = new Map<string, string[]>();
  const englishKeys = englishTranslationKeys(data);
  let zhCnItemCount = 0;
  let iconItemCount = 0;

  for (const block of data.blocksArray) {
    const blockId = namespaced(block.name);
    const itemName = resolveBlockItemName(block, data);
    const itemId = itemName ? namespaced(itemName) : null;
    blocks[blockId] = {
      numericId: Number.isInteger(block.id) ? block.id : null,
      name: blockId,
      displayNameEn: block.displayName,
      itemId,
      ...(typeof block.minStateId === "number" ? { minStateId: block.minStateId } : {}),
      ...(typeof block.maxStateId === "number" ? { maxStateId: block.maxStateId } : {}),
      dataSource: DATA_SOURCE,
      confidence: itemId ? "cross-checked" : "inferred",
    };
    legacyBlockIds[String(block.id)] = blockId;
    for (const variation of block.variations ?? []) {
      legacyBlockIds[`${block.id}:${variation.metadata}`] = blockId;
    }
    if (itemId) {
      blockToItem[blockId] = itemId;
      const names = blockNamesByItem.get(itemId) ?? [];
      names.push(blockId);
      blockNamesByItem.set(itemId, names);
    }
  }

  for (const item of data.itemsArray) {
    const itemId = namespaced(item.name);
    const localizedName = resolveZhCnName(item, localization, englishKeys);
    const icon = wikiIcons.get(item.displayName) ?? null;
    const iconSource = wikiIconSources.get(item.displayName);
    if (localizedName.name) zhCnItemCount += 1;
    if (icon) iconItemCount += 1;
    items[itemId] = {
      numericId: Number.isInteger(item.id) ? item.id : null,
      name: itemId,
      displayNameEn: item.displayName,
      ...(localizedName.name ? { displayNameZhCn: localizedName.name } : {}),
      maxStackSize: Number.isInteger(item.stackSize) && item.stackSize > 0 ? item.stackSize : null,
      ...(blockNamesByItem.get(itemId)?.length ? { blockNames: blockNamesByItem.get(itemId) } : {}),
      itemModel: `minecraft:item/${item.name}`,
      textureKey: `minecraft:item/${item.name}`,
      ...(icon ?? {}),
      ...(iconSource ? { iconSourceUrl: iconSource.descriptionUrl } : {}),
      dataSource: localizedName.official ? `${DATA_SOURCE}; Mojang versioned zh_cn` : DATA_SOURCE,
      confidence: localizedName.official ? "verified" : "cross-checked",
    };
  }

  const result = {
    schemaVersion: 1,
    version,
    minecraftVersion: version,
    dataVersion: data.version.dataVersion ?? null,
    protocolVersion: data.version.version ?? null,
    generatedAt,
    sources: [...SOURCE_URLS, ...ICON_SOURCE_URLS, ...(localization?.sourceUrls ?? [])],
    items,
    blocks,
    blockToItem,
    legacyBlockIds,
  };

  await writeFile(path.join(JAVA_ROOT, `${version}.json`), `${JSON.stringify(result)}\n`, "utf8");

  return {
    version,
    dataVersion: result.dataVersion,
    protocolVersion: result.protocolVersion,
    itemCount: Object.keys(items).length,
    blockCount: Object.keys(blocks).length,
    zhCnItemCount,
    iconItemCount,
    iconSourceVersion: "Minecraft Wiki",
    dataFile: `java/${version}.json`,
    dataSource: DATA_SOURCE,
    supportStatus: "partially-supported",
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  await mkdir(JAVA_ROOT, { recursive: true });
  await mkdir(REPORT_ROOT, { recursive: true });

  const localizations = await loadOfficialLocalizations(TARGET_VERSIONS);
  const displayNames = TARGET_VERSIONS.flatMap((version) => {
    const data = minecraftDataFactory(version);
    return data?.itemsArray.map((item) => item.displayName) ?? [];
  });
  const wikiIconData = await loadWikiIcons(displayNames);
  const versions = [];
  for (const version of TARGET_VERSIONS) {
    versions.push(
      await generateVersion(
        version,
        generatedAt,
        localizations.data.get(version),
        wikiIconData.icons,
        wikiIconData.sources,
      ),
    );
  }
  await writeIcons();

  const dataVersionEntries = minecraftDataFactory.versions.pc
    .filter((entry) => Number.isInteger(entry.dataVersion))
    .map((entry) => ({
      minecraftVersion: entry.minecraftVersion,
      dataVersion: entry.dataVersion,
      protocolVersion: Number.isInteger(entry.version) ? entry.version : null,
      majorVersion: entry.majorVersion,
      releaseType:
        entry.releaseType === "release" || entry.releaseType === "snapshot"
          ? entry.releaseType
          : "unknown",
    }));

  await writeFile(
    path.join(OUTPUT_ROOT, "versions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt,
        sourceUrls: SOURCE_URLS,
        versions,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(OUTPUT_ROOT, "data-version-map.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt,
        sourceUrls: [
          "https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/common/protocolVersions.json",
          ...SOURCE_URLS,
        ],
        entries: dataVersionEntries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const itemTotal = versions.reduce((sum, version) => sum + version.itemCount, 0);
  const blockTotal = versions.reduce((sum, version) => sum + version.blockCount, 0);
  const zhCnItemTotal = versions.reduce((sum, version) => sum + version.zhCnItemCount, 0);
  const iconItemTotal = versions.reduce((sum, version) => sum + version.iconItemCount, 0);
  await writeFile(
    path.join(REPORT_ROOT, "minecraft-data-report.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt,
        generator: "scripts/update-minecraft-data.ts",
        minecraftDataPackageVersion: packageJson.version,
        generatedVersionCount: versions.length,
        generatedVersions: versions.map((entry) => entry.version),
        itemRecordCount: itemTotal,
        blockRecordCount: blockTotal,
        zhCnItemRecordCount: zhCnItemTotal,
        chineseNameMissingRate: itemTotal === 0 ? 0 : (itemTotal - zhCnItemTotal) / itemTotal,
        dataVersionRecordCount: dataVersionEntries.length,
        localization: {
          strategy:
            "per-version Mojang zh_cn language assets, optional curated stable fallback, then English and raw ID",
          warning:
            "English-to-language-key matching can remain incomplete for ambiguous legacy names and variant metadata.",
          officialLocalizationVersionCount: localizations.data.size,
          updateWarnings: localizations.warnings,
        },
        iconData: {
          strategy:
            "build-time Minecraft Wiki Invicon lookup through MediaWiki API; PNG/GIF files are downloaded locally, content-hash deduplicated, and loaded lazily",
          source: ICON_DATA_SOURCE,
          sourceTemplate: "Invicon <English display name>.png or .gif, following redirects",
          iconItemRecordCount: iconItemTotal,
          iconMissingRecordCount: itemTotal - iconItemTotal,
          uniqueIconFileCount: iconFiles.size,
          uniqueDisplayNameCount: new Set(displayNames).size,
          matchedDisplayNameCount: wikiIconData.icons.size,
          matchedWikiFileCount: new Set(
            [...wikiIconData.sources.values()].map((entry) => entry.imageUrl),
          ).size,
          downloadWarnings: wikiIconData.warnings,
          rightsNotice:
            "Minecraft Wiki file pages identify these inventory images as Mojang content. Copying them locally does not transfer ownership or create a new license; Minecraft artwork remains Mojang/Microsoft content and deployments must follow the Minecraft Usage Guidelines.",
        },
        sourceUrls: [...SOURCE_URLS, ...ICON_SOURCE_URLS],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Generated ${versions.length} Minecraft data files from ${DATA_SOURCE}.`);
}

await main();
