import { useRef, useState, type ChangeEvent } from "react";
import { importModResources, type ModResourceImportResult } from "../../lib/mod-resources";

interface ModResourceImporterProps {
  targetIds: string[];
  onImported: (result: ModResourceImportResult) => void;
}

export function ModResourceImporter({ targetIds, onImported }: ModResourceImporterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ModResourceImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await importModResources(files, targetIds);
      setResult(imported);
      onImported(imported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取所选模组资源");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mod-resource-importer" aria-label="模组物品资源">
      <div>
        <span className="eyebrow">
          <i /> 检测到模组命名空间
        </span>
        <strong>{targetIds.length} 个模组材料</strong>
        <p>
          可导入本机模组 JAR 或资源包 ZIP，读取标准语言文件、物品模型和 PNG
          纹理。文件只在浏览器本地解析，刷新后需重新导入；堆叠上限仍需手动确认。
        </p>
        {result ? (
          <small role="status">
            已读取 {result.archiveCount} 个资源包，匹配 {result.matchedItemCount} /{" "}
            {targetIds.length} 个模组材料。
          </small>
        ) : null}
      </div>
      <div className="mod-resource-importer__actions">
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".jar,.zip,application/java-archive,application/zip"
          multiple
          onChange={(event) => void handleFiles(event)}
        />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "正在读取…" : "导入模组 JAR / 资源包"}
        </button>
        {result?.warnings.length ? (
          <details>
            <summary>{result.warnings.length} 条导入提示</summary>
            <ul>
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {error ? <small className="row-warning">{error}</small> : null}
      </div>
    </section>
  );
}
