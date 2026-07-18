import type { DownloadMaterialWorkbookOptions, MaterialWorkbookInput } from "./types";
import { buildMaterialWorkbook } from "./workbook";

export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const INVALID_FILE_NAME_CHARACTERS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

function sanitizeFileNameStem(value: string): string {
  return [...value]
    .map((character) =>
      character.charCodeAt(0) <= 31 || INVALID_FILE_NAME_CHARACTERS.has(character)
        ? "-"
        : character,
    )
    .join("")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
}

function copyToArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return new Uint8Array(buffer).slice().buffer;
}

export function createMaterialWorkbookFileName(input: MaterialWorkbookInput): string {
  const originalFileName = input.metadata.originalFileName?.trim();
  if (originalFileName) {
    const uploadedFileStem = sanitizeFileNameStem(originalFileName.replace(/\.litematic$/i, ""));
    if (uploadedFileStem) return `${uploadedFileStem}.xlsx`;
  }

  const date = input.exportedAt ?? new Date();
  const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, "0")))
    .join("-");
  const projectionName = sanitizeFileNameStem(input.metadata.name?.trim() || "投影");

  return `${projectionName || "投影"}-材料清单-${datePart}.xlsx`;
}

export async function createMaterialWorkbook(input: MaterialWorkbookInput): Promise<ArrayBuffer> {
  const buffer = await buildMaterialWorkbook(input).xlsx.writeBuffer();
  return copyToArrayBuffer(buffer);
}

export async function createMaterialWorkbookBlob(input: MaterialWorkbookInput): Promise<Blob> {
  return new Blob([await createMaterialWorkbook(input)], { type: XLSX_MIME_TYPE });
}

export async function downloadMaterialWorkbook(
  input: MaterialWorkbookInput,
  options: DownloadMaterialWorkbookOptions = {},
): Promise<Blob> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("当前环境不支持浏览器文件下载");
  }

  const blob = await createMaterialWorkbookBlob(input);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = options.fileName ?? createMaterialWorkbookFileName(input);
  anchor.hidden = true;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return blob;
}
