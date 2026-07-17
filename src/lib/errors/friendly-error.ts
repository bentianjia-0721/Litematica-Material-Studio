const ERROR_RULES: Array<[RegExp, string]> = [
  [/gzip|inflate|decompress|header check/i, "gzip 数据损坏，或文件并非有效的 .litematic。"],
  [/NBT|tag|compound|unexpected end|bounds/i, "NBT 数据不完整或结构异常。"],
  [/palette|block.?state|long.?array|volume/i, "方块状态数据长度异常，无法安全解析。"],
  [/memory|allocation|out of memory/i, "浏览器内存不足，请关闭其他大型页面后重试。"],
  [/too large|limit|maximum|exceed/i, "文件内容超过安全解析上限。"],
  [/format version|unsupported/i, "暂不支持这个 Litematic 格式版本。"],
];

export function toFriendlyError(error: unknown): { message: string; detail?: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const match = ERROR_RULES.find(([pattern]) => pattern.test(detail));
  return {
    message: match?.[1] ?? "文件不是有效的 .litematic，或包含暂不支持的数据。",
    ...(import.meta.env.DEV && detail ? { detail } : {}),
  };
}
