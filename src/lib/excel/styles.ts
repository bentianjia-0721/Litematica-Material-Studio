import type { Cell, Row, Worksheet } from "exceljs";

const COLORS = {
  border: "FFD7E2EF",
  header: "FF17324D",
  input: "FFFFF3CD",
  inputFont: "FF7A4D00",
  unknown: "FFFFE2E2",
  unknownFont: "FF9C1C1C",
  invalid: "FFFFC7CE",
  invalidFont: "FF9C0006",
} as const;

export function styleHeader(row: Row): void {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.header },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: COLORS.border } },
    };
    cell.protection = { locked: true };
  });
}

export function styleMaterialInput(cell: Cell): void {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.input },
  };
  cell.font = { color: { argb: COLORS.inputFont } };
  cell.protection = { locked: false };
}

export function styleUnknownMaterial(row: Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (Number(cell.col) === 4 || Number(cell.col) === 6) {
      return;
    }

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.unknown },
    };
    cell.font = { ...cell.font, color: { argb: COLORS.unknownFont } };
  });
}

export function addMaterialConditionalFormatting(worksheet: Worksheet, lastRow: number): void {
  if (lastRow < 2) {
    return;
  }

  worksheet.addConditionalFormatting({
    ref: `J2:J${lastRow}`,
    rules: [
      {
        type: "colorScale",
        priority: 1,
        cfvo: [
          { type: "num", value: 0 },
          { type: "num", value: 0.5 },
          { type: "num", value: 1 },
        ],
        color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }],
      },
    ],
  });

  worksheet.addConditionalFormatting({
    ref: `D2:D${lastRow}`,
    rules: [
      {
        type: "expression",
        priority: 2,
        formulae: ["OR(NOT(ISNUMBER(D2)),D2<0,D2<>INT(D2))"],
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: COLORS.invalid } },
          font: { color: { argb: COLORS.invalidFont } },
        },
      },
    ],
  });

  worksheet.addConditionalFormatting({
    ref: `F2:F${lastRow}`,
    rules: [
      {
        type: "expression",
        priority: 3,
        formulae: ["OR(NOT(ISNUMBER(F2)),F2<0,F2<>INT(F2),F2>D2)"],
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: COLORS.invalid } },
          font: { color: { argb: COLORS.invalidFont } },
        },
      },
    ],
  });
}
