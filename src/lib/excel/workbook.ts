import { Workbook, type CellValue, type Worksheet } from "exceljs";
import {
  calculateStackBreakdown,
  completionFormula,
  remainingFormula,
  stackBreakdownFormula,
} from "./formulas";
import {
  addMaterialConditionalFormatting,
  styleHeader,
  styleMaterialInput,
  styleUnknownMaterial,
} from "./styles";
import type { ExcelDateValue, ExcelMaterialRow, MaterialWorkbookInput } from "./types";

const UNKNOWN_VALUE = "未知";
const DEFAULT_TOOL_VERSION = "Litematica Material Studio 1.0.0";

const MATERIAL_COLUMNS = [
  { header: "序号", key: "index", width: 8 },
  { header: "物品名称", key: "itemName", width: 24 },
  { header: "Minecraft ID", key: "minecraftId", width: 32 },
  { header: "总共需要", key: "totalRequired", width: 14 },
  { header: "总需求堆叠", key: "totalStacks", width: 20 },
  { header: "已经拥有", key: "owned", width: 14 },
  { header: "已拥有堆叠", key: "ownedStacks", width: 20 },
  { header: "剩余需要", key: "remaining", width: 14 },
  { header: "剩余堆叠", key: "remainingStacks", width: 20 },
  { header: "完成度", key: "completion", width: 12 },
  { header: "备注", key: "note", width: 26 },
  { header: "最大堆叠数量", key: "maxStackSize", width: 16 },
] as const;

function assertQuantity(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} 必须是大于等于 0 的安全整数`);
  }
}

function assertMaterial(material: ExcelMaterialRow, index: number): void {
  assertQuantity(material.totalRequired, `第 ${index + 1} 行的总需求`);
  assertQuantity(material.owned, `第 ${index + 1} 行的已拥有`);

  if (
    material.maxStackSize !== null &&
    (!Number.isSafeInteger(material.maxStackSize) || material.maxStackSize <= 0)
  ) {
    throw new RangeError(`第 ${index + 1} 行的最大堆叠数量必须是正安全整数或 null`);
  }
}

function addMaterialRow(worksheet: Worksheet, material: ExcelMaterialRow, index: number): void {
  assertMaterial(material, index);

  const rowNumber = index + 2;
  const remaining = Math.max(0, material.totalRequired - material.owned);
  const completion =
    material.totalRequired === 0 ? 1 : Math.min(1, material.owned / material.totalRequired);
  const row = worksheet.addRow([
    index + 1,
    material.itemName,
    material.minecraftId,
    material.totalRequired,
    {
      formula: stackBreakdownFormula("D", rowNumber),
      result: calculateStackBreakdown(material.totalRequired, material.maxStackSize),
    },
    material.owned,
    {
      formula: stackBreakdownFormula("F", rowNumber),
      result: calculateStackBreakdown(material.owned, material.maxStackSize),
    },
    { formula: remainingFormula(rowNumber), result: remaining },
    {
      formula: stackBreakdownFormula("H", rowNumber),
      result: calculateStackBreakdown(remaining, material.maxStackSize),
    },
    { formula: completionFormula(rowNumber), result: completion },
    material.note ?? (material.unknownOrMod ? "未知或 Mod 物品" : ""),
    material.maxStackSize,
  ]);

  row.height = 22;
  row.alignment = { vertical: "middle" };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  row.getCell(2).alignment = { vertical: "middle", wrapText: true };
  row.getCell(3).alignment = { vertical: "middle", wrapText: true };
  row.getCell(11).alignment = { vertical: "middle", wrapText: true };

  for (const columnNumber of [4, 6, 8, 12]) {
    row.getCell(columnNumber).numFmt = "0";
  }
  row.getCell(10).numFmt = "0.00%";

  styleMaterialInput(row.getCell(4));
  styleMaterialInput(row.getCell(6));

  for (const columnNumber of [1, 2, 3, 5, 7, 8, 9, 10, 11, 12]) {
    row.getCell(columnNumber).protection = { locked: true };
  }

  row.getCell(4).dataValidation = {
    type: "whole",
    operator: "greaterThanOrEqual",
    allowBlank: false,
    formulae: [0],
    showErrorMessage: true,
    errorTitle: "输入无效",
    error: "请输入大于等于 0 的整数。",
    showInputMessage: true,
    promptTitle: "总共需要",
    prompt: "请输入大于等于 0 的整数。",
  };
  row.getCell(6).dataValidation = {
    type: "custom",
    allowBlank: false,
    formulae: [
      `AND(ISNUMBER(F${rowNumber}),F${rowNumber}=INT(F${rowNumber}),F${rowNumber}>=0,F${rowNumber}<=D${rowNumber})`,
    ],
    showErrorMessage: true,
    errorTitle: "输入无效",
    error: "已经拥有必须是 0 到总需求之间的整数。",
    showInputMessage: true,
    promptTitle: "已经拥有",
    prompt: "请输入不大于总需求的非负整数。",
  };

  if (material.unknownOrMod) {
    styleUnknownMaterial(row);
  }
}

function configureMaterialWorksheet(worksheet: Worksheet, input: MaterialWorkbookInput): void {
  worksheet.columns = MATERIAL_COLUMNS.map((column) => ({ ...column }));
  worksheet.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2", activeCell: "A2" }];
  worksheet.autoFilter = `A1:L${Math.max(1, input.materials.length + 1)}`;
  worksheet.properties.defaultRowHeight = 20;
  worksheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  styleHeader(worksheet.getRow(1));
  input.materials.forEach((material, index) => addMaterialRow(worksheet, material, index));

  worksheet.getColumn(12).hidden = true;
  addMaterialConditionalFormatting(worksheet, input.materials.length + 1);

  // No password is intentional: protection keeps formulas intact while allowing D/F edits,
  // but users can still remove it if they need to customize the workbook.
  void worksheet.protect("", {
    autoFilter: true,
    sort: true,
    selectLockedCells: true,
    selectUnlockedCells: true,
  });
}

function valueOrUnknown(value: CellValue | undefined | null): CellValue {
  if (value === undefined || value === null || value === "") {
    return UNKNOWN_VALUE;
  }
  return value;
}

function dateValueOrUnknown(value: ExcelDateValue | undefined): CellValue {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? UNKNOWN_VALUE : new Date(value.getTime());
  }
  return valueOrUnknown(value);
}

function configureProjectionWorksheet(worksheet: Worksheet, input: MaterialWorkbookInput): void {
  const metadata = input.metadata;
  const exportedAt = input.exportedAt ?? new Date();
  const dimensions = metadata.dimensions;
  const warnings = metadata.warnings?.filter(Boolean).join("\n") || "无";
  const rows: Array<[string, CellValue]> = [
    ["投影名称", valueOrUnknown(metadata.name)],
    ["作者", valueOrUnknown(metadata.author)],
    ["描述", valueOrUnknown(metadata.description)],
    ["创建时间", dateValueOrUnknown(metadata.createdAt)],
    ["修改时间", dateValueOrUnknown(metadata.modifiedAt)],
    ["原始文件名", valueOrUnknown(metadata.originalFileName)],
    ["文件大小（字节）", valueOrUnknown(metadata.fileSizeBytes)],
    ["X 尺寸", valueOrUnknown(dimensions?.x)],
    ["Y 尺寸", valueOrUnknown(dimensions?.y)],
    ["Z 尺寸", valueOrUnknown(dimensions?.z)],
    ["Region 数量", valueOrUnknown(metadata.regionCount)],
    ["Minecraft 原始 DataVersion", valueOrUnknown(metadata.dataVersion)],
    ["自动识别的 Minecraft 版本", valueOrUnknown(metadata.detectedMinecraftVersion)],
    ["当前使用的物品数据版本", valueOrUnknown(input.minecraftVersion)],
    ["版本匹配方式", valueOrUnknown(metadata.versionMatchType)],
    ["Litematic 格式版本", valueOrUnknown(metadata.litematicFormatVersion)],
    ["Litematic 格式子版本", valueOrUnknown(metadata.litematicSubVersion)],
    ["总体积", valueOrUnknown(metadata.totalVolume)],
    ["非空气方块数", valueOrUnknown(metadata.nonAirBlockCount)],
    ["材料种类数", valueOrUnknown(metadata.materialCount ?? input.materials.length)],
    [
      "未识别物品数",
      valueOrUnknown(
        metadata.unknownItemCount ??
          input.materials.filter((material) => material.unknownOrMod).length,
      ),
    ],
    ["导出时间", exportedAt],
    ["工具版本", input.toolVersion ?? DEFAULT_TOOL_VERSION],
    ["已知警告", warnings],
  ];

  worksheet.columns = [
    { header: "字段", key: "field", width: 34 },
    { header: "值", key: "value", width: 64 },
  ];
  worksheet.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2", activeCell: "A2" }];
  worksheet.autoFilter = `A1:B${rows.length + 1}`;
  styleHeader(worksheet.getRow(1));

  rows.forEach(([field, value]) => {
    const row = worksheet.addRow([field, value]);
    row.getCell(1).font = { bold: true, color: { argb: "FF17324D" } };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEAF0F6" },
    };
    row.getCell(2).alignment = { vertical: "top", wrapText: true };
    if (value instanceof Date) {
      row.getCell(2).numFmt = "yyyy-mm-dd hh:mm:ss";
    }
  });
}

export function buildMaterialWorkbook(input: MaterialWorkbookInput): Workbook {
  const workbook = new Workbook();
  const exportedAt = input.exportedAt ?? new Date();

  workbook.creator = input.toolVersion ?? DEFAULT_TOOL_VERSION;
  workbook.lastModifiedBy = input.toolVersion ?? DEFAULT_TOOL_VERSION;
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  workbook.calcProperties.fullCalcOnLoad = true;

  configureMaterialWorksheet(workbook.addWorksheet("材料清单"), input);
  configureProjectionWorksheet(workbook.addWorksheet("投影信息"), { ...input, exportedAt });

  return workbook;
}
