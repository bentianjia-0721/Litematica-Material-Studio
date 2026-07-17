import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { StudioMaterial } from "../../app/types";
import { ItemIcon } from "../../components/ItemIcon";
import { StackValue } from "./StackValue";

interface MaterialTableProps {
  materials: StudioMaterial[];
  onQuantityChange: (id: string, field: "required" | "owned" | "remaining", value: number) => void;
  onMaxStackSizeChange: (id: string, value: number | null) => void;
}

function normalizeInput(value: string, max?: number) {
  const digits = value.replace(/[^0-9]/g, "").slice(0, 15);
  const number = digits === "" ? 0 : Number(digits);
  return Math.min(
    Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER,
    max ?? Number.MAX_SAFE_INTEGER,
  );
}

interface QuantityEditorProps {
  value: number;
  max: number | undefined;
  label: string;
  materialName: string;
  maxStackSize: number | null;
  onChange: (value: number) => void;
}

function QuantityEditor({
  value,
  max,
  label,
  materialName,
  maxStackSize,
  onChange,
}: QuantityEditorProps) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const warningId = useId();
  const exceedsMaximum = max !== undefined && draft !== "" && Number(draft) > max;

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const update = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 15);
    setDraft(digits);
    if (digits !== "") onChange(normalizeInput(digits, max));
  };

  const commit = () => {
    focused.current = false;
    const normalized = normalizeInput(draft, max);
    setDraft(String(normalized));
    onChange(normalized);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? 1 : -1;
    const normalized = normalizeInput(String(Math.max(0, normalizeInput(draft, max) + delta)), max);
    setDraft(String(normalized));
    onChange(normalized);
  };

  return (
    <label className="quantity-field">
      <span className="visually-hidden">
        {materialName} {label}
      </span>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update(event.target.value)}
        aria-label={`${materialName} ${label}`}
        aria-invalid={exceedsMaximum}
        aria-describedby={exceedsMaximum ? warningId : undefined}
      />
      <StackValue quantity={value} maxStackSize={maxStackSize} label={label} />
      {exceedsMaximum ? (
        <small className="input-warning" id={warningId}>
          不能超过 {max.toLocaleString("zh-CN")}
        </small>
      ) : null}
    </label>
  );
}

export function MaterialTable({
  materials,
  onQuantityChange,
  onMaxStackSizeChange,
}: MaterialTableProps) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(materials.length / pageSize));
  const visible = useMemo(
    () => materials.slice(page * pageSize, (page + 1) * pageSize),
    [materials, page],
  );

  const input = (
    material: StudioMaterial,
    field: "required" | "owned" | "remaining",
    label: string,
  ) => {
    const max = field === "required" ? undefined : material.required;
    return (
      <QuantityEditor
        value={material[field]}
        max={max}
        label={label}
        materialName={material.displayName}
        maxStackSize={material.maxStackSize}
        onChange={(value) => onQuantityChange(material.id, field, value)}
      />
    );
  };

  return (
    <section className="table-shell" aria-label="材料清单">
      <div className="material-grid material-grid--header" role="row">
        <span>材料</span>
        <span>数据状态</span>
        <span>总共需要</span>
        <span>已经拥有</span>
        <span>剩余需要</span>
        <span>完成度</span>
      </div>
      <div className="material-list">
        {visible.map((material) => {
          const percent =
            material.required === 0 ? 100 : Math.round((material.owned / material.required) * 100);
          const statusClass =
            material.status === "未知" ? "unknown" : material.status === "模组" ? "mod" : "known";
          return (
            <article className="material-grid material-row" key={material.id}>
              <div className="material-name">
                <ItemIcon
                  itemId={material.id}
                  displayName={material.displayName}
                  src={material.iconPath}
                />
                <span>
                  <strong>{material.displayName}</strong>
                  <small>{material.id}</small>
                </span>
              </div>
              <div>
                <span className={`status-chip status-chip--${statusClass}`}>{material.status}</span>
                {material.maxStackSize === null || material.status === "用户设置" ? (
                  <label className="max-stack-editor">
                    <span>堆叠上限</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={999}
                      value={material.maxStackSize ?? ""}
                      placeholder="?"
                      aria-label={`${material.displayName} 手动堆叠上限`}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                        onMaxStackSizeChange(
                          material.id,
                          digits ? Math.max(1, Number(digits)) : null,
                        );
                      }}
                    />
                  </label>
                ) : null}
                {material.warning ? (
                  <small className="row-warning">{material.warning}</small>
                ) : null}
              </div>
              <div data-label="总共需要">{input(material, "required", "总共需要")}</div>
              <div data-label="已经拥有">{input(material, "owned", "已经拥有")}</div>
              <div data-label="剩余需要">{input(material, "remaining", "剩余需要")}</div>
              <div className="completion-cell" data-label="完成度">
                <strong>{percent}%</strong>
                <span>
                  <i style={{ width: `${percent}%` }} />
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {materials.length === 0 ? <div className="empty-state">当前筛选下没有材料。</div> : null}
      {pages > 1 ? (
        <nav className="pagination" aria-label="材料分页">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            上一页
          </button>
          <span>
            第 {page + 1} / {pages} 页
          </span>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </section>
  );
}
