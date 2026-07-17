import { Workbook, type CellFormulaValue, type Worksheet } from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildMaterialWorkbook,
  createMaterialWorkbook,
  createMaterialWorkbookFileName,
  type MaterialWorkbookInput,
} from "../src/lib/excel";

const input: MaterialWorkbookInput = {
  metadata: {
    name: "海底基地",
    author: "Builder",
    description: "测试投影",
    createdAt: new Date("2026-07-10T01:02:03.000Z"),
    modifiedAt: new Date("2026-07-15T04:05:06.000Z"),
    originalFileName: "ocean-base.litematic",
    fileSizeBytes: 123_456,
    dimensions: { x: 20, y: 12, z: 30 },
    regionCount: 2,
    dataVersion: 4435,
    detectedMinecraftVersion: "1.21.8",
    versionMatchType: "exact",
    litematicFormatVersion: 7,
    litematicSubVersion: 1,
    totalVolume: 7_200,
    nonAirBlockCount: 257,
    materialCount: 3,
    unknownItemCount: 1,
    warnings: ["包含一个 Mod 物品"],
  },
  minecraftVersion: "1.21.8",
  materials: [
    {
      itemName: "橡木原木",
      minecraftId: "minecraft:oak_log",
      totalRequired: 129,
      owned: 32,
      maxStackSize: 64,
    },
    {
      itemName: "末影珍珠",
      minecraftId: "minecraft:ender_pearl",
      totalRequired: 16,
      owned: 16,
      maxStackSize: 16,
      note: "已齐",
    },
    {
      itemName: "modded:block",
      minecraftId: "example:modded_block",
      totalRequired: 4,
      owned: 1,
      maxStackSize: null,
      unknownOrMod: true,
    },
  ],
  exportedAt: new Date("2026-07-16T08:00:00.000Z"),
  toolVersion: "Litematica Material Studio test",
};

async function loadGeneratedWorkbook(): Promise<Workbook> {
  const bytes = await createMaterialWorkbook(input);
  expect(bytes).toBeInstanceOf(ArrayBuffer);
  expect(bytes.byteLength).toBeGreaterThan(1_000);

  const workbook = new Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

function getFormulaValue(worksheet: Worksheet, address: string): CellFormulaValue {
  const value = worksheet.getCell(address).value;
  if (typeof value !== "object" || value === null || !("formula" in value)) {
    throw new TypeError(`${address} 不是公式单元格`);
  }
  return value as CellFormulaValue;
}

describe("Excel 材料清单导出", () => {
  it("生成可重新打开的双工作表 xlsx，并保留投影信息", async () => {
    expect(buildMaterialWorkbook(input).calcProperties.fullCalcOnLoad).toBe(true);
    const workbook = await loadGeneratedWorkbook();

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "材料清单",
      "投影信息",
    ]);
    const info = workbook.getWorksheet("投影信息");
    expect(info).toBeDefined();
    expect(info?.getCell("A2").value).toBe("投影名称");
    expect(info?.getCell("B2").value).toBe("海底基地");

    const currentVersionRow = info
      ?.getColumn(1)
      .values.findIndex((value) => value === "当前使用的物品数据版本");
    expect(currentVersionRow).toBeGreaterThan(1);
    expect(info?.getCell(currentVersionRow!, 2).value).toBe("1.21.8");
  });

  it("按指定列写入可编辑数量、联动公式和隐藏堆叠辅助数据", async () => {
    const workbook = await loadGeneratedWorkbook();
    const sheet = workbook.getWorksheet("材料清单")!;

    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "序号",
      "物品名称",
      "Minecraft ID",
      "总共需要",
      "总需求堆叠",
      "已经拥有",
      "已拥有堆叠",
      "剩余需要",
      "剩余堆叠",
      "完成度",
      "备注",
      "最大堆叠数量",
    ]);
    expect(sheet.getCell("D2").value).toBe(129);
    expect(sheet.getCell("F2").value).toBe(32);
    expect(sheet.getCell("D2").protection.locked).toBe(false);
    expect(sheet.getCell("F2").protection.locked).toBe(false);

    expect(getFormulaValue(sheet, "E2").formula).toContain("D2");
    expect(getFormulaValue(sheet, "E2").result).toBe("2 组 + 1 个");
    expect(getFormulaValue(sheet, "G2").formula).toContain("F2");
    expect(getFormulaValue(sheet, "G2").result).toBe("32 个");
    expect(sheet.getCell("H2").value).toEqual({ formula: "MAX(0,D2-F2)", result: 97 });
    expect(getFormulaValue(sheet, "I2").formula).toContain("H2");
    expect(getFormulaValue(sheet, "I2").result).toBe("1 组 + 33 个");
    expect(sheet.getCell("J2").value).toEqual({
      formula: "IF(D2=0,1,MIN(1,F2/D2))",
      result: 32 / 129,
    });
    expect(sheet.getCell("L2").value).toBe(64);
    expect(sheet.getColumn("L").hidden).toBe(true);
    expect(sheet.getCell("F2").dataValidation.type).toBe("custom");
  });

  it("冻结标题、开启筛选和条件格式，且不添加 Comment 或 Note", async () => {
    const workbook = await loadGeneratedWorkbook();
    const sheet = workbook.getWorksheet("材料清单")!;

    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:L4");
    expect(
      (sheet as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings,
    ).toHaveLength(3);

    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        expect(cell.note).toBeUndefined();
      });
    });
  });

  it("生成安全且稳定的下载文件名", () => {
    expect(createMaterialWorkbookFileName(input)).toBe("海底基地-材料清单-2026-07-16.xlsx");
    expect(
      createMaterialWorkbookFileName({
        ...input,
        metadata: { ...input.metadata, name: 'bad:/\\name*?"' },
      }),
    ).toBe("bad---name----材料清单-2026-07-16.xlsx");
  });
});
