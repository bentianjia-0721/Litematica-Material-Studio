import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src/data/minecraft");
const REPORT_ROOT = path.join(ROOT, "reports");

interface VersionSummary {
  version: string;
  dataVersion: number | null;
  dataFile: string;
  supportStatus: string;
}

interface VersionData {
  minecraftVersion: string;
  dataVersion: number | null;
  sources: string[];
  items: Record<string, { maxStackSize: number | null; displayNameZhCn?: string }>;
  blocks: Record<string, { itemId: string | null }>;
}

interface CompatibilityEntry {
  litematicaVersion: string;
  minecraftVersion: string;
  minecraftDataVersion: number | null;
  litematicFormatVersion: number | null;
  sourceUrls: string[];
  supportStatus: string;
}

async function main() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const versionsFile = JSON.parse(await readFile(path.join(ROOT, "versions.json"), "utf8")) as {
    versions: VersionSummary[];
  };
  const compatibilityFile = JSON.parse(
    await readFile(path.join(ROOT, "litematica-compatibility.json"), "utf8"),
  ) as { entries: CompatibilityEntry[] };

  const seenVersions = new Set<string>();
  let totalItems = 0;
  let missingZh = 0;
  let totalBlocks = 0;
  let missingBlockMappings = 0;

  for (const summary of versionsFile.versions) {
    if (seenVersions.has(summary.version)) errors.push(`Duplicate version: ${summary.version}`);
    seenVersions.add(summary.version);
    const absoluteDataFile = path.join(ROOT, summary.dataFile);
    try {
      await access(absoluteDataFile);
    } catch {
      errors.push(`Missing data file: ${summary.dataFile}`);
      continue;
    }
    const data = JSON.parse(await readFile(absoluteDataFile, "utf8")) as VersionData;
    if (data.minecraftVersion !== summary.version) {
      errors.push(
        `${summary.dataFile} declares ${data.minecraftVersion}, expected ${summary.version}`,
      );
    }
    if (data.dataVersion !== summary.dataVersion) {
      errors.push(`${summary.version} DataVersion differs between index and data file`);
    }
    if (!data.sources.length) errors.push(`${summary.version} has no source URLs`);
    for (const [itemId, item] of Object.entries(data.items)) {
      totalItems += 1;
      if (!item.displayNameZhCn) missingZh += 1;
      if (
        item.maxStackSize !== null &&
        (!Number.isInteger(item.maxStackSize) || item.maxStackSize < 1)
      ) {
        errors.push(`${summary.version} ${itemId} has invalid maxStackSize`);
      }
    }
    for (const block of Object.values(data.blocks)) {
      totalBlocks += 1;
      if (!block.itemId) missingBlockMappings += 1;
    }
  }

  const relationshipKeys = new Set<string>();
  for (const entry of compatibilityFile.entries) {
    const key = `${entry.litematicaVersion}|${entry.minecraftVersion}`;
    if (relationshipKeys.has(key)) warnings.push(`Duplicate release relationship: ${key}`);
    relationshipKeys.add(key);
    if (!entry.sourceUrls.length) errors.push(`${key} has no source URL`);
    if (entry.supportStatus === "fully-supported") {
      if (!seenVersions.has(entry.minecraftVersion)) {
        errors.push(`${key} is fully-supported without local item data`);
      }
      if (entry.minecraftDataVersion === null || entry.litematicFormatVersion === null) {
        errors.push(`${key} is fully-supported with missing version evidence`);
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    generatedAt,
    valid: errors.length === 0,
    checkedVersionCount: versionsFile.versions.length,
    checkedCompatibilityEntryCount: compatibilityFile.entries.length,
    chineseNameMissingRate: totalItems === 0 ? 0 : missingZh / totalItems,
    blockToItemMissingRate: totalBlocks === 0 ? 0 : missingBlockMappings / totalBlocks,
    errors,
    warnings,
  };
  await writeFile(
    path.join(REPORT_ROOT, "version-data-validation-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (errors.length)
    throw new Error(`Version data validation failed with ${errors.length} error(s)`);
  console.log(
    `Validated ${versionsFile.versions.length} data files and ${compatibilityFile.entries.length} compatibility entries.`,
  );
  console.log(`Chinese-name missing rate: ${(report.chineseNameMissingRate * 100).toFixed(2)}%`);
  console.log(`Block-to-item missing rate: ${(report.blockToItemMissingRate * 100).toFixed(2)}%`);
}

await main();
