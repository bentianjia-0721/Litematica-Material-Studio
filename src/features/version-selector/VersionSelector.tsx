interface VersionSelectorProps {
  detectedVersion: string | null;
  selectedVersion: string | null;
  versions: string[];
  onChange: (version: string | null) => void;
}

export function VersionSelector({
  detectedVersion,
  selectedVersion,
  versions,
  onChange,
}: VersionSelectorProps) {
  const value = selectedVersion ?? "__auto__";
  return (
    <label className="version-selector">
      <span>物品数据版本</span>
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value === "__auto__" ? null : event.target.value)
        }
      >
        <option value="__auto__">自动识别：{detectedVersion ?? "未知"}</option>
        {versions.map((version) => (
          <option key={version} value={version}>
            Minecraft Java {version}
          </option>
        ))}
      </select>
      {selectedVersion ? (
        <small>投影原始识别版本：{detectedVersion ?? "未知"} · 当前为手动选择</small>
      ) : (
        <small>优先使用 DataVersion 精确匹配</small>
      )}
    </label>
  );
}
