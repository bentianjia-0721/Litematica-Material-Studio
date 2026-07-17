import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { importModResources } from "../src/lib/mod-resources";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function makeExampleMod(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "assets/examplemod/lang/zh_cn.json",
    JSON.stringify({ "block.examplemod.glowing_bricks": "发光砖" }),
  );
  zip.file(
    "assets/examplemod/lang/en_us.json",
    JSON.stringify({ "block.examplemod.glowing_bricks": "Glowing Bricks" }),
  );
  zip.file(
    "assets/examplemod/models/item/glowing_bricks.json",
    JSON.stringify({ parent: "examplemod:block/glowing_bricks" }),
  );
  zip.file(
    "assets/examplemod/models/block/glowing_bricks.json",
    JSON.stringify({
      parent: "minecraft:block/cube_all",
      textures: { all: "examplemod:block/glowing_bricks" },
    }),
  );
  zip.file("assets/examplemod/textures/block/glowing_bricks.png", base64Bytes(ONE_PIXEL_PNG));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], "examplemod.jar", { type: "application/java-archive" });
}

describe("importModResources", () => {
  it("从标准模组语言、模型和纹理资源补全当前投影中的模组物品", async () => {
    const result = await importModResources(
      [await makeExampleMod()],
      ["examplemod:glowing_bricks", "missingmod:unknown_item", "minecraft:stone"],
    );

    expect(result.archiveCount).toBe(1);
    expect(result.matchedItemCount).toBe(1);
    expect(result.resources["examplemod:glowing_bricks"]).toMatchObject({
      id: "examplemod:glowing_bricks",
      displayName: "发光砖",
      displayNameEn: "Glowing Bricks",
      sourceFile: "examplemod.jar",
      namespace: "examplemod",
    });
    expect(result.resources["examplemod:glowing_bricks"]?.iconPath).toMatch(
      /^data:image\/png;base64,/u,
    );
    expect(result.resources["minecraft:stone"]).toBeUndefined();
    expect(result.warnings).toContain("未在所选文件中找到 missingmod 资源命名空间");
  });

  it("跳过非 ZIP/JAR 文件并保留可见提示", async () => {
    const result = await importModResources(
      [new File(["plain text"], "readme.txt", { type: "text/plain" })],
      ["examplemod:glowing_bricks"],
    );

    expect(result.archiveCount).toBe(0);
    expect(result.matchedItemCount).toBe(0);
    expect(result.warnings).toContain("readme.txt：只支持 .jar 或 .zip");
  });
});
