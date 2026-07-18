import { writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import { createLitematicFixture } from "../tests/fixtures/litematic-fixture";

const outputPath = path.resolve(process.cwd(), "tests/fixtures/smoke.litematic");
const modResourceOutputPath = path.resolve(
  process.cwd(),
  "tests/fixtures/examplemod-resources.zip",
);
const width = 6;
const height = 3;
const depth = 5;
const blockIndices = Array<number>(width * height * depth).fill(0);
const setBlock = (x: number, y: number, z: number, paletteIndex: number) => {
  blockIndices[x + z * width + y * width * depth] = paletteIndex;
};
for (let z = 0; z < depth; z += 1) {
  for (let x = 0; x < width; x += 1) setBlock(x, 0, z, 1);
}
setBlock(0, 1, 0, 2);
setBlock(1, 1, 0, 3);
setBlock(2, 1, 0, 4);
setBlock(3, 1, 0, 5);
setBlock(3, 2, 0, 6);
setBlock(4, 1, 0, 7);
setBlock(4, 2, 0, 7);
setBlock(5, 1, 0, 8);
setBlock(0, 1, 1, 9);
setBlock(1, 1, 1, 10);
setBlock(2, 1, 1, 11);
setBlock(3, 1, 1, 12);
setBlock(4, 1, 1, 13);
setBlock(5, 1, 1, 14);
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
      position: { x: 10, y: 72, z: 4 },
      size: { x: -width, y: -height, z: -depth },
      palette: [
        { name: "minecraft:air" },
        { name: "minecraft:stone" },
        {
          name: "minecraft:oak_stairs",
          properties: {
            facing: "east",
            half: "bottom",
            shape: "straight",
            waterlogged: "false",
          },
        },
        { name: "minecraft:observer", properties: { facing: "north", powered: "false" } },
        { name: "minecraft:oak_log", properties: { axis: "z" } },
        {
          name: "minecraft:oak_door",
          properties: {
            facing: "north",
            half: "lower",
            hinge: "left",
            open: "false",
            powered: "false",
          },
        },
        {
          name: "minecraft:oak_door",
          properties: {
            facing: "north",
            half: "upper",
            hinge: "left",
            open: "false",
            powered: "false",
          },
        },
        { name: "minecraft:nether_portal", properties: { axis: "x" } },
        { name: "minecraft:water", properties: { level: "0" } },
        {
          name: "minecraft:oak_slab",
          properties: { type: "bottom", waterlogged: "false" },
        },
        {
          name: "minecraft:redstone_wire",
          properties: {
            east: "none",
            north: "none",
            power: "15",
            south: "none",
            west: "none",
          },
        },
        { name: "minecraft:glass" },
        { name: "examplemod:glowing_bricks" },
        { name: "minecraft:powder_snow" },
        {
          name: "minecraft:rail",
          properties: { shape: "ascending_east", waterlogged: "false" },
        },
      ],
      blockIndices,
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
