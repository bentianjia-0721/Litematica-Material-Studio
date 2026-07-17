import { useMemo, useState } from "react";
import type { StudioCatalogItem, StudioMaterial } from "../../app/types";
import { ItemIcon } from "../../components/ItemIcon";

type CatalogFilter = "all" | "blocks" | "items" | "project";

interface ItemCatalogProps {
  version: string;
  items: StudioCatalogItem[];
  materials: StudioMaterial[];
}

const PAGE_SIZE = 72;

export function ItemCatalog({ version, items, materials }: ItemCatalogProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [page, setPage] = useState(0);
  const requiredById = useMemo(
    () => new Map(materials.map((material) => [material.id, material.required])),
    [materials],
  );
  const iconCount = useMemo(() => items.filter((item) => item.iconPath).length, [items]);
  const iconSourceVersions = useMemo(
    () => [
      ...new Set(items.flatMap((item) => (item.iconSourceVersion ? [item.iconSourceVersion] : []))),
    ],
    [items],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (
        needle &&
        !`${item.displayName} ${item.displayNameEn} ${item.id}`.toLocaleLowerCase().includes(needle)
      ) {
        return false;
      }
      if (filter === "blocks" && !item.isBlock) return false;
      if (filter === "items" && item.isBlock) return false;
      if (filter === "project" && !requiredById.has(item.id)) return false;
      return true;
    });
  }, [filter, items, query, requiredById]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <section className="catalog-section" aria-labelledby="catalog-title">
      <div className="catalog-heading">
        <div>
          <span className="eyebrow">
            <i /> 当前版本完整注册表
          </span>
          <h2 id="catalog-title">Minecraft Java {version} 全部物品</h2>
          <p>
            已加载 {items.length.toLocaleString("zh-CN")} 项；{iconCount.toLocaleString("zh-CN")}{" "}
            项有版本图标。
            {iconSourceVersions.length === 1 && iconSourceVersions[0] !== version
              ? ` 图标资源使用最近兼容版本 ${iconSourceVersions[0]}。`
              : ""}
          </p>
        </div>
        <strong>{filtered.length.toLocaleString("zh-CN")} 项</strong>
      </div>
      <div className="catalog-toolbar">
        <label className="search-field">
          <span className="visually-hidden">搜索当前版本全部物品</span>
          <i aria-hidden="true">⌕</i>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="搜索中文、英文或 Minecraft ID"
          />
        </label>
        <label className="select-field">
          <span>目录范围</span>
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as CatalogFilter);
              setPage(0);
            }}
          >
            <option value="all">全部物品</option>
            <option value="blocks">方块物品</option>
            <option value="items">非方块物品</option>
            <option value="project">投影中需要</option>
          </select>
        </label>
      </div>
      {visible.length ? (
        <div className="catalog-grid">
          {visible.map((item) => {
            const required = requiredById.get(item.id);
            return (
              <article
                className={`catalog-card${required ? " catalog-card--required" : ""}`}
                key={item.id}
              >
                <ItemIcon
                  itemId={item.id}
                  displayName={item.displayName}
                  src={item.iconPath}
                  compact
                />
                <div className="catalog-card__body">
                  <strong>{item.displayName}</strong>
                  <small>{item.id}</small>
                  <span>
                    {item.isBlock ? "方块" : "物品"} · 堆叠上限 {item.maxStackSize ?? "未知"}
                  </span>
                </div>
                {required ? <em>投影需要 ×{required.toLocaleString("zh-CN")}</em> : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">当前筛选下没有物品。</div>
      )}
      {pageCount > 1 ? (
        <nav className="pagination" aria-label="完整物品目录分页">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            上一页
          </button>
          <span>
            第 {currentPage + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </section>
  );
}
