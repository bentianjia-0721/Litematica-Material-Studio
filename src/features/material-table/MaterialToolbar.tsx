export type MaterialFilter = "all" | "incomplete" | "complete" | "unknown";
export type MaterialSort = "required-desc" | "remaining-desc" | "completion-asc" | "name";

interface MaterialToolbarProps {
  query: string;
  filter: MaterialFilter;
  sort: MaterialSort;
  count: number;
  canUndo: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: MaterialFilter) => void;
  onSort: (value: MaterialSort) => void;
  onResetOwned: () => void;
  onCompleteAll: () => void;
  onUndo: () => void;
}

export function MaterialToolbar(props: MaterialToolbarProps) {
  return (
    <section className="material-toolbar" aria-label="材料筛选和批量操作">
      <div className="section-title">
        <div>
          <span className="eyebrow">
            <i /> 材料计划
          </span>
          <h2>材料清单</h2>
        </div>
        <strong>{props.count} 项</strong>
      </div>
      <div className="toolbar-row">
        <label className="search-field">
          <span className="visually-hidden">搜索材料</span>
          <i aria-hidden="true">⌕</i>
          <input
            type="search"
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            placeholder="搜索中文名或 Minecraft ID"
          />
        </label>
        <label className="select-field">
          <span>状态</span>
          <select
            value={props.filter}
            onChange={(event) => props.onFilter(event.target.value as MaterialFilter)}
          >
            <option value="all">全部材料</option>
            <option value="incomplete">只看未完成</option>
            <option value="complete">只看已完成</option>
            <option value="unknown">未知或 Mod</option>
          </select>
        </label>
        <label className="select-field">
          <span>排序</span>
          <select
            value={props.sort}
            onChange={(event) => props.onSort(event.target.value as MaterialSort)}
          >
            <option value="required-desc">总需求从高到低</option>
            <option value="remaining-desc">剩余从高到低</option>
            <option value="completion-asc">完成度从低到高</option>
            <option value="name">名称</option>
          </select>
        </label>
      </div>
      <div className="batch-actions">
        <button type="button" onClick={props.onResetOwned}>
          全部已有清零
        </button>
        <button type="button" onClick={props.onCompleteAll}>
          标记全部完成
        </button>
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo}>
          撤销批量操作
        </button>
      </div>
    </section>
  );
}
