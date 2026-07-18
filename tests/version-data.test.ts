import { describe, expect, it } from "vitest";
import {
  detectMinecraftVersion,
  getItemData,
  hasMinecraftVersionData,
  listMinecraftVersions,
  loadMinecraftVersionData,
} from "../src/lib/minecraft-data";
import { convertBlockStateCounts } from "../src/lib/materials";

describe("versioned Minecraft data", () => {
  it("lists only generated, exactly addressable data files", () => {
    const versions = listMinecraftVersions().map((entry) => entry.version);
    expect(versions).toContain("1.12.2");
    expect(versions).toContain("1.21.11");
    expect(versions).not.toContain("26.2");
    expect(hasMinecraftVersionData("1.20.1")).toBe(true);
    expect(hasMinecraftVersionData("9.99")).toBe(false);
  });

  it("dynamically loads an exact version without substituting a newer one", async () => {
    const oldData = await loadMinecraftVersionData("1.12.2");
    const newData = await loadMinecraftVersionData("1.21.11");
    expect(oldData.minecraftVersion).toBe("1.12.2");
    expect(oldData.version).toBe("1.12.2");
    expect(newData.minecraftVersion).toBe("1.21.11");
    expect(getItemData(oldData, "ender_pearl")?.maxStackSize).toBe(16);
    expect(getItemData(newData, "minecraft:ender_pearl")?.maxStackSize).toBe(16);
    expect(getItemData(oldData, "minecraft:copper_block")).toBeUndefined();
    expect(getItemData(newData, "minecraft:copper_block")?.textureKey).toBe(
      "minecraft:item/copper_block",
    );
    expect(Object.keys(oldData.items).length).toBeGreaterThan(400);
    expect(Object.keys(newData.items).length).toBeGreaterThan(1_300);
    expect(getItemData(oldData, "minecraft:stone")?.iconPath).toMatch(
      /^\/minecraft-icons\/[a-f0-9]{20}\.(?:png|gif)$/u,
    );
    expect(getItemData(newData, "minecraft:stone")?.iconPath).toBe(
      getItemData(oldData, "minecraft:stone")?.iconPath,
    );
    expect(getItemData(newData, "minecraft:stone")?.iconSourceVersion).toBe("Minecraft Wiki");
    expect(getItemData(newData, "minecraft:stone")?.iconSourceUrl).toMatch(
      /^https:\/\/minecraft\.wiki\/w\/File:Invicon_/u,
    );
    await expect(loadMinecraftVersionData("9.99")).rejects.toThrow(
      /newer version is not used implicitly/u,
    );
  });

  it("uses distinct Minecraft Wiki inventory icons for shaped block items", async () => {
    const data = await loadMinecraftVersionData("1.21.1");
    const iconPaths = ["tuff", "tuff_slab", "tuff_stairs", "tuff_wall"].map(
      (name) => getItemData(data, `minecraft:${name}`)?.iconPath,
    );
    expect(iconPaths.every(Boolean)).toBe(true);
    expect(new Set(iconPaths).size).toBe(iconPaths.length);
  });
});

describe("Minecraft version detection", () => {
  it("matches an exact DataVersion", () => {
    const match = detectMinecraftVersion(3465);
    expect(match.type).toBe("exact");
    expect(match.minecraftVersion).toBe("1.20.1");
    expect(match.originalDetectedVersion).toBe("1.20.1");
  });

  it("labels a nearby same-series fallback as compatible", () => {
    const match = detectMinecraftVersion(3466);
    expect(match.matchType).toBe("compatible");
    expect(match.selectedVersion).toBe("1.20.1");
    expect(match.warnings.join(" ")).toContain("兼容候选");
  });

  it("does not use the newest version for unknown or missing DataVersions", () => {
    expect(detectMinecraftVersion(null).selectedVersion).toBeNull();
    expect(detectMinecraftVersion(999_999).selectedVersion).toBeNull();
    const formatHint = detectMinecraftVersion(null, { formatVersion: 6 });
    expect(formatHint.selectedVersion).toBeNull();
    expect(formatHint.candidates.length).toBeGreaterThan(0);
  });

  it("uses metadata only as an explicitly marked inference", () => {
    const match = detectMinecraftVersion(null, { metadataVersion: "1.19.4" });
    expect(match.type).toBe("inferred");
    expect(match.version).toBe("1.19.4");
    const compatible = detectMinecraftVersion(null, { metadataVersion: "1.20.3" });
    expect(compatible.type).toBe("compatible");
    expect(compatible.originalDetectedVersion).toBe("1.20.3");
    expect(compatible.minecraftVersion).toBe("1.20.4");
  });

  it("automatically loads the nearest same-series data for a recognized patch", async () => {
    const match = detectMinecraftVersion(3698);
    expect(match.type).toBe("compatible");
    expect(match.originalDetectedVersion).toBe("1.20.3");
    expect(match.selectedVersion).toBe("1.20.4");
    expect(match.warnings.join(" ")).toContain("自动使用同系列 1.20.4 数据");
    const data = await loadMinecraftVersionData(match.minecraftVersion ?? "");
    expect(data.minecraftVersion).toBe("1.20.4");
    expect(Object.keys(data.blocks).length).toBeGreaterThan(900);
    const materials = convertBlockStateCounts({ "minecraft:cherry_planks": 12 }, data);
    expect(materials).toMatchObject([
      { id: "minecraft:cherry_planks", required: 12, status: "verified" },
    ]);
  });
});
