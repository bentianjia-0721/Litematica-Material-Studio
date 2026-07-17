import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

const MAX_FILE_SIZE = 128 * 1024 * 1024;

interface UploadPanelProps {
  onFile: (file: File) => void;
  restoredProjectName?: string | undefined;
  onDismissRestore?: () => void;
  externalError?: string | null | undefined;
}

export function UploadPanel({
  onFile,
  restoredProjectName,
  onDismissRestore,
  externalError,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptFile = (file?: File) => {
    setError(null);
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".litematic")) {
      setError("请选择 .litematic 投影文件。");
      return;
    }
    if (file.size === 0) {
      setError("文件内容为空，无法解析。");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("文件超过 128 MiB 的浏览器安全上限。");
      return;
    }
    onFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files.item(0) ?? undefined);
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.item(0) ?? undefined);
    event.target.value = "";
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <main className="upload-page" id="main-content">
      <section className="hero" aria-labelledby="hero-title">
        <div className="eyebrow">
          <span /> 浏览器端投影工程台
        </div>
        <h1 id="hero-title">把投影文件，变成真正可执行的材料计划。</h1>
        <p>
          读取 Litematica 元数据、识别 Minecraft 版本、统计材料并导出带公式的 Excel。
          全程只在这台设备上处理。
        </p>
      </section>

      {restoredProjectName ? (
        <aside className="restore-banner" aria-label="本地进度提示">
          <span className="restore-banner__icon">↺</span>
          <span>
            <strong>发现本地编辑进度</strong>
            <small>{restoredProjectName} · 再次选择同一文件即可恢复</small>
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={onDismissRestore}
            aria-label="关闭提示"
          >
            ×
          </button>
        </aside>
      ) : null}

      <section className="upload-shell">
        <div
          className={`drop-zone${dragging ? " drop-zone--active" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="拖拽或选择 Litematic 文件"
          onClick={() => inputRef.current?.click()}
          onKeyDown={onKeyDown}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".litematic"
            onClick={(event) => event.stopPropagation()}
            onChange={onInput}
          />
          <div className="voxel-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <b />
          </div>
          <span className="drop-zone__label">{dragging ? "松开以开始解析" : "将投影拖到这里"}</span>
          <span className="drop-zone__hint">或点击选择一个 .litematic 文件</span>
          <span className="drop-zone__limit">最大 128 MiB · gzip + NBT · 支持多 Region</span>
        </div>
        <div className="privacy-card">
          <div className="privacy-card__badge" aria-hidden="true">
            ⌁
          </div>
          <div>
            <strong>你的建筑，不离开浏览器</strong>
            <p>文件不会上传到服务器；解析、材料统计和 Excel 生成均在本地完成。</p>
          </div>
        </div>
      </section>

      <div className="error-region" role="alert" aria-live="assertive">
        {error ?? externalError}
      </div>

      <section className="feature-strip" aria-label="主要功能">
        <article>
          <span>01</span>
          <strong>版本感知</strong>
          <p>优先依据 DataVersion 匹配物品数据。</p>
        </article>
        <article>
          <span>02</span>
          <strong>材料联动</strong>
          <p>总量、已有与剩余保持一致并自动保存。</p>
        </article>
        <article>
          <span>03</span>
          <strong>可编辑 Excel</strong>
          <p>堆叠拆分和完成度保留为工作表公式。</p>
        </article>
      </section>
    </main>
  );
}
