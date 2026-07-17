import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT_ROOT = path.resolve(process.cwd(), "src/data/minecraft");
const REPORT_ROOT = path.join(OUTPUT_ROOT, "reports");
const MODRINTH_API = "https://api.modrinth.com/v2/project/litematica/version";
const OFFICIAL_REPOSITORY = "https://github.com/maruohon/litematica";

interface ModrinthDependency {
  project_id?: string;
  version_id?: string;
  dependency_type?: string;
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  date_published: string;
  game_versions: string[];
  version_type: string;
  dependencies: ModrinthDependency[];
}

interface DataVersionEntry {
  minecraftVersion: string;
  dataVersion: number;
  releaseType: string;
}

interface VersionFile {
  versions: Array<{ version: string }>;
}

function formatEvidence(version: string): {
  format: number | null;
  subVersion: number | null;
  confidence: "verified" | "cross-checked" | "inferred";
  source?: string;
} {
  if (/^1\.(14|15|16)(\.|$)/.test(version)) {
    return {
      format: 5,
      subVersion: null,
      confidence: "verified",
      source: `${OFFICIAL_REPOSITORY}/blob/pre-rewrite/fabric/${version.startsWith("1.14") ? "1.14.x" : version.startsWith("1.15") ? "1.15.x" : "1.16.x"}/src/main/java/fi/dy/masa/litematica/schematic/LitematicaSchematic.java`,
    };
  }
  if (/^1\.(17|18|19)(\.|$)/.test(version)) {
    return { format: 5, subVersion: null, confidence: "inferred" };
  }
  if (version === "1.20.1") {
    return {
      format: 6,
      subVersion: 1,
      confidence: "verified",
      source: `${OFFICIAL_REPOSITORY}/blob/pre-rewrite/fabric/1.20.1/src/main/java/fi/dy/masa/litematica/schematic/LitematicaSchematic.java`,
    };
  }
  if (/^1\.20\./.test(version)) {
    return { format: 6, subVersion: 1, confidence: "inferred" };
  }
  if (version === "1.21" || version === "1.21.1") {
    return {
      format: 7,
      subVersion: 1,
      confidence: "verified",
      source: `${OFFICIAL_REPOSITORY}/blob/pre-rewrite/fabric/1.21.1-masa/src/main/java/fi/dy/masa/litematica/schematic/LitematicaSchematic.java`,
    };
  }
  if (/^(1\.21\.|26\.)/.test(version)) {
    return { format: 7, subVersion: 1, confidence: "inferred" };
  }
  return { format: null, subVersion: null, confidence: "inferred" };
}

async function gitRefs(kind: "heads" | "tags") {
  try {
    const { stdout } = await execFileAsync("git", [
      "ls-remote",
      `--${kind}`,
      `${OFFICIAL_REPOSITORY}.git`,
    ]);
    return stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => line.split("\t")[1]?.replace(`refs/${kind}/`, ""))
      .filter((value): value is string => Boolean(value));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), refs: [] as string[] };
  }
}

async function fetchModrinthVersions(): Promise<ModrinthVersion[]> {
  const response = await fetch(MODRINTH_API, {
    headers: { "User-Agent": "Litematica-Material-Studio/1.0 (version research)" },
  });
  if (!response.ok) throw new Error(`Modrinth returned HTTP ${response.status}`);
  return (await response.json()) as ModrinthVersion[];
}

async function main() {
  const generatedAt = new Date().toISOString();
  await mkdir(REPORT_ROOT, { recursive: true });
  const dataVersionMap = JSON.parse(
    await readFile(path.join(OUTPUT_ROOT, "data-version-map.json"), "utf8"),
  ) as { entries: DataVersionEntry[] };
  const localVersions = JSON.parse(
    await readFile(path.join(OUTPUT_ROOT, "versions.json"), "utf8"),
  ) as VersionFile;
  const localSet = new Set(localVersions.versions.map((entry) => entry.version));
  const releaseDataVersions = new Map(
    dataVersionMap.entries
      .filter((entry) => entry.releaseType === "release")
      .map((entry) => [entry.minecraftVersion, entry.dataVersion]),
  );

  const errors: string[] = [];
  let releases: ModrinthVersion[];
  try {
    releases = await fetchModrinthVersions();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    try {
      const existing = JSON.parse(
        await readFile(path.join(OUTPUT_ROOT, "litematica-compatibility.json"), "utf8"),
      ) as { entries: unknown[] };
      console.warn("Network research failed; preserving the existing compatibility matrix.");
      if (existing.entries.length === 0) throw error;
      return;
    } catch {
      throw error;
    }
  }

  const branchesResult = await gitRefs("heads");
  const tagsResult = await gitRefs("tags");
  const branches = Array.isArray(branchesResult) ? branchesResult : branchesResult.refs;
  const tags = Array.isArray(tagsResult) ? tagsResult : tagsResult.refs;
  if (!Array.isArray(branchesResult)) errors.push(`Git branches: ${branchesResult.error}`);
  if (!Array.isArray(tagsResult)) errors.push(`Git tags: ${tagsResult.error}`);

  const entries = releases.flatMap((release) =>
    release.game_versions.map((minecraftVersion) => {
      const evidence = formatEvidence(minecraftVersion);
      const dataVersion = releaseDataVersions.get(minecraftVersion) ?? null;
      const hasLocalData = localSet.has(minecraftVersion);
      const explicitlyUnsupported = /do[-_ ]?not[-_ ]?use|broken/iu.test(release.version_number);
      const relationshipVerified = dataVersion !== null && evidence.confidence === "verified";
      const sourceUrls = [
        `https://modrinth.com/mod/litematica/version/${release.id}`,
        MODRINTH_API,
        ...(evidence.source ? [evidence.source] : []),
      ];
      return {
        litematicaVersion: release.version_number,
        minecraftVersion,
        minecraftDataVersion: dataVersion,
        litematicFormatVersion: evidence.format,
        litematicSubVersion: evidence.subVersion,
        releaseDate: release.date_published,
        sourceUrls,
        confidence: relationshipVerified
          ? "verified"
          : dataVersion !== null && evidence.format !== null
            ? "cross-checked"
            : "inferred",
        supportStatus: explicitlyUnsupported
          ? "unsupported"
          : hasLocalData || evidence.format !== null
            ? "partially-supported"
            : "unverified",
      };
    }),
  );

  await writeFile(
    path.join(OUTPUT_ROOT, "litematica-compatibility.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt,
        sources: [MODRINTH_API, OFFICIAL_REPOSITORY],
        entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const uniqueMinecraftVersions = new Set(entries.map((entry) => entry.minecraftVersion));
  const conflictKeys = new Map<string, Set<number | null>>();
  for (const entry of entries) {
    const key = `${entry.litematicaVersion}|${entry.minecraftVersion}`;
    const formats = conflictKeys.get(key) ?? new Set<number | null>();
    formats.add(entry.litematicFormatVersion);
    conflictKeys.set(key, formats);
  }
  const conflicts = [...conflictKeys]
    .filter(([, formats]) => formats.size > 1)
    .map(([key, formats]) => ({ key, formatVersions: [...formats] }));

  const statusCounts = {
    fullySupported: entries.filter((entry) => entry.supportStatus === "fully-supported").length,
    partiallySupported: entries.filter((entry) => entry.supportStatus === "partially-supported")
      .length,
    unverified: entries.filter((entry) => entry.supportStatus === "unverified").length,
    unsupported: entries.filter((entry) => entry.supportStatus === "unsupported").length,
  };
  const report = {
    schemaVersion: 1,
    generatedAt,
    researchMethod:
      "All version records from the author-controlled Modrinth project plus read-only refs and selected format constants from the official source repository.",
    discoveredLitematicaReleaseCount: releases.length,
    compatibilityEntryCount: entries.length,
    discoveredMinecraftVersionCount: uniqueMinecraftVersions.size,
    verifiedDataVersionCount: new Set(
      entries
        .map((entry) => entry.minecraftDataVersion)
        .filter((value): value is number => value !== null),
    ).size,
    verifiedLitematicFormatVersions: [
      ...new Set(
        entries
          .filter((entry) => entry.confidence === "verified")
          .map((entry) => entry.litematicFormatVersion)
          .filter((value): value is number => value !== null),
      ),
    ].sort(),
    supportStatusCounts: statusCounts,
    officialBranchCount: branches.length,
    officialTagCount: tags.length,
    officialBranches: branches,
    conflicts,
    versionsMissingLocalItemData: [...uniqueMinecraftVersions]
      .filter((version) => !localSet.has(version))
      .sort(),
    versionsMissingVerifiedFormatEvidence: [...uniqueMinecraftVersions]
      .filter((version) => formatEvidence(version).confidence !== "verified")
      .sort(),
    missingRealSamples:
      "No third-party user builds are bundled. Parser fixtures are generated by tests; release-by-release real-file coverage remains incomplete.",
    limitations: [
      "Modrinth publication dates for older imported files can reflect the import date rather than the original historical release date.",
      "A format constant verified on a source branch does not prove that every release targeting that game version emitted the same sub-version.",
      "Entries without direct source evidence remain inferred or partially supported.",
      "No release relationship is labelled fully-supported until a licensed real file from that release family is included in repeatable tests.",
    ],
    errors,
    sourceUrls: [MODRINTH_API, OFFICIAL_REPOSITORY],
  };
  await writeFile(
    path.join(REPORT_ROOT, "litematica-version-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Recorded ${releases.length} Litematica releases and ${entries.length} game-version relationships.`,
  );
}

await main();
