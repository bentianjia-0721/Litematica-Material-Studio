import type { ProcessingStage } from "../../app/types";

const STAGES: ProcessingStage[] = [
  "读取文件",
  "解压 gzip",
  "解析 NBT",
  "识别版本",
  "加载物品数据",
  "解码方块状态",
  "统计材料",
  "生成结果",
];

interface ProcessingPanelProps {
  fileName: string;
  stage: ProcessingStage;
  progress: number;
  detail?: string | undefined;
  onCancel: () => void;
}

export function ProcessingPanel({
  fileName,
  stage,
  progress,
  detail,
  onCancel,
}: ProcessingPanelProps) {
  const current = STAGES.indexOf(stage);
  return (
    <main className="processing-page" id="main-content" aria-live="polite">
      <section className="processing-card">
        <div className="scanner" aria-hidden="true">
          <div className="scanner__cube" />
          <i />
        </div>
        <div className="eyebrow">
          <span /> 本地解析中
        </div>
        <h1>{stage}</h1>
        <p className="processing-card__file" title={fileName}>
          {fileName}
        </p>
        <div
          className="progress-track"
          aria-label="解析进度"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <i style={{ width: `${Math.max(2, progress)}%` }} />
        </div>
        <div className="progress-meta">
          <span>{detail ?? "请保持此页面打开"}</span>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <ol className="stage-list">
          {STAGES.map((item, index) => (
            <li key={item} className={index < current ? "done" : index === current ? "active" : ""}>
              <span>{index < current ? "✓" : String(index + 1).padStart(2, "0")}</span>
              {item}
            </li>
          ))}
        </ol>
        <button className="button button--quiet" type="button" onClick={onCancel}>
          取消解析
        </button>
      </section>
    </main>
  );
}
