import { writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import { createLitematicFixture } from "../tests/fixtures/litematic-fixture";

const outputPath = path.resolve(process.cwd(), "tests/fixtures/smoke.litematic");
const modResourceOutputPath = path.resolve(
  process.cwd(),
  "tests/fixtures/examplemod-resources.zip",
);
const fixture = createLitematicFixture({
  minecraftDataVersion: 3955,
  metadata: {
    name: "LMS 浏览器验收样本",
    author: "Codex",
    description: "由项目测试夹具生成，不包含第三方建筑或游戏纹理。",
  },
  regions: [
    {
      name: "Main",
      position: { x: 4, y: 70, z: -3 },
      size: { x: -4, y: 2, z: 3 },
      palette: [
        { name: "minecraft:air" },
        { name: "minecraft:stone" },
        { name: "minecraft:oak_door", properties: { half: "lower", facing: "north" } },
        { name: "minecraft:oak_door", properties: { half: "upper", facing: "north" } },
        { name: "examplemod:glowing_bricks" },
      ],
      blockIndices: [1, 1, 1, 1, 1, 2, 1, 4, 0, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 4, 0, 1, 1, 1],
    },
  ],
});

await writeFile(outputPath, fixture);
console.log(`Generated ${fixture.byteLength} byte smoke fixture at ${outputPath}`);

const modResources = new JSZip();
modResources.file(
  "assets/examplemod/lang/zh_cn.json",
  JSON.stringify({ "block.examplemod.glowing_bricks": "发光砖" }),
);
modResources.file(
  "assets/examplemod/lang/en_us.json",
  JSON.stringify({ "block.examplemod.glowing_bricks": "Glowing Bricks" }),
);
modResources.file(
  "assets/examplemod/models/item/glowing_bricks.json",
  JSON.stringify({ parent: "examplemod:block/glowing_bricks" }),
);
modResources.file(
  "assets/examplemod/models/block/glowing_bricks.json",
  JSON.stringify({
    parent: "minecraft:block/cube_all",
    textures: { all: "examplemod:block/glowing_bricks" },
  }),
);
modResources.file(
  "assets/examplemod/textures/block/glowing_bricks.png",
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const modResourceArchive = await modResources.generateAsync({ type: "nodebuffer" });
await writeFile(modResourceOutputPath, modResourceArchive);
console.log(
  `Generated ${modResourceArchive.byteLength} byte Mod resource fixture at ${modResourceOutputPath}`,
);
