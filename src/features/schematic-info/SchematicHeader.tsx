import type { StudioProject } from "../../app/types";

function formatDate(value: number | null) {
  if (value === null) return "文件未提供";
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(millis);
  return Number.isNaN(date.getTime())
    ? "未知"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

interface SchematicHeaderProps {
  project: StudioProject;
}

export function SchematicHeader({ project }: SchematicHeaderProps) {
  const { metadata } = project;
  const total = project.materials.reduce((sum, material) => sum + material.required, 0);
  const owned = project.materials.reduce((sum, material) => sum + material.owned, 0);
  const completion = total === 0 ? 100 : Math.round((owned / total) * 100);
  const unknown = project.materials.filter(
    (material) => material.status === "未知" || material.status === "模组",
  ).length;
  return (
    <>
      <section className="project-hero">
        <div>
          <div className="eyebrow">
            <span /> 投影已就绪
          </div>
          <h1>{metadata.name || project.fileName}</h1>
          <p>{metadata.description || "文件未提供投影描述。"}</p>
          <div className="project-byline">
            <span>作者 {metadata.author || "未知"}</span>
            <i />{" "}
            <span>
              {project.fileName} · {formatBytes(project.fileSize)}
            </span>
          </div>
        </div>
        <div
          className="completion-orb"
          style={{ "--completion": `${completion * 3.6}deg` } as React.CSSProperties}
        >
          <div>
            <strong>{completion}%</strong>
            <span>整体完成度</span>
          </div>
        </div>
      </section>

      <section className="stat-grid" aria-label="投影摘要">
        <article>
          <small>Minecraft 版本</small>
          <strong>{project.detectedVersion ?? "无法识别"}</strong>
          <span>DataVersion {metadata.minecraftDataVersion ?? "未知"}</span>
        </article>
        <article>
          <small>投影边界</small>
          <strong>
            {metadata.enclosingSize.x} × {metadata.enclosingSize.y} × {metadata.enclosingSize.z}
          </strong>
          <span>{metadata.regionCount} 个 Region</span>
        </article>
        <article>
          <small>非空气方块</small>
          <strong>{metadata.totalBlocks.toLocaleString("zh-CN")}</strong>
          <span>总体积 {metadata.totalVolume.toLocaleString("zh-CN")}</span>
        </article>
        <article>
          <small>材料种类</small>
          <strong>{project.materials.length.toLocaleString("zh-CN")}</strong>
          <span>{unknown} 个未知或 Mod 物品</span>
        </article>
      </section>

      <details className="metadata-details">
        <summary>查看完整投影信息</summary>
        <dl>
          <div>
            <dt>创建时间</dt>
            <dd>{formatDate(metadata.timeCreated)}</dd>
          </div>
          <div>
            <dt>修改时间</dt>
            <dd>{formatDate(metadata.timeModified)}</dd>
          </div>
          <div>
            <dt>Litematic 格式</dt>
            <dd>
              {metadata.formatVersion ?? "未知"}
              {metadata.subVersion === null ? "" : ` / 子版本 ${metadata.subVersion}`}
            </dd>
          </div>
          <div>
            <dt>物品数据版本</dt>
            <dd>{project.selectedVersion ?? project.detectedVersion ?? "未加载"}</dd>
          </div>
          <div>
            <dt>版本匹配方式</dt>
            <dd>{project.matchType}</dd>
          </div>
          <div>
            <dt>本地项目 ID</dt>
            <dd className="break-all">{project.projectId}</dd>
          </div>
        </dl>
      </details>
    </>
  );
}
