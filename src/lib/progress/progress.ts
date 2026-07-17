export type ProgressField = "total" | "owned" | "remaining";

export type ProgressIssueCode =
  "empty" | "invalid" | "negative" | "fractional" | "too-large" | "clamped";

export interface ProgressIssue {
  field: ProgressField;
  code: ProgressIssueCode;
  message: string;
  input: string;
}

export interface ProgressEntry {
  id: string;
  total: number;
  owned: number;
  remaining: number;
  drafts: Record<ProgressField, string>;
  issues: ProgressIssue[];
}

interface ProgressSnapshot {
  values: Record<string, { total: number; owned: number }>;
}

export interface ProgressState {
  entries: Record<string, ProgressEntry>;
  order: string[];
  history: ProgressSnapshot[];
  historyLimit: number;
  maxValue: number;
}

export interface ProgressSeed {
  id: string;
  required: number;
  owned?: number;
}

export interface ProgressOptions {
  historyLimit?: number;
  maxValue?: number;
}

export interface OverallProgress {
  total: number;
  owned: number;
  remaining: number;
  ratio: number;
  percent: number;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return fallback;
  return value as number;
}

function clampInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(maximum, Math.floor(value));
}

function normalizeSeeds(
  source: readonly ProgressSeed[] | Readonly<Record<string, number>>,
): ProgressSeed[] {
  if (Array.isArray(source)) {
    return (source as readonly ProgressSeed[]).map((seed) => ({ ...seed }));
  }
  const record = source as Readonly<Record<string, number>>;
  return Object.keys(record).map((id) => ({ id, required: record[id] ?? 0 }));
}

function createEntry(id: string, total: number, owned: number, maxValue: number): ProgressEntry {
  const normalizedTotal = clampInteger(total, maxValue);
  const normalizedOwned = Math.min(normalizedTotal, clampInteger(owned, maxValue));
  const remaining = normalizedTotal - normalizedOwned;
  return {
    id,
    total: normalizedTotal,
    owned: normalizedOwned,
    remaining,
    drafts: {
      total: String(normalizedTotal),
      owned: String(normalizedOwned),
      remaining: String(remaining),
    },
    issues: [],
  };
}

export function createProgressState(
  source: readonly ProgressSeed[] | Readonly<Record<string, number>>,
  options: ProgressOptions = {},
): ProgressState {
  const maxValue = normalizeLimit(options.maxValue, Number.MAX_SAFE_INTEGER);
  const historyLimit = normalizeLimit(options.historyLimit, 50);
  const entries: Record<string, ProgressEntry> = {};
  const order: string[] = [];
  for (const seed of normalizeSeeds(source)) {
    if (!seed.id || entries[seed.id]) continue;
    entries[seed.id] = createEntry(seed.id, seed.required, seed.owned ?? 0, maxValue);
    order.push(seed.id);
  }
  return { entries, order, history: [], historyLimit, maxValue };
}

function snapshot(state: ProgressState): ProgressSnapshot {
  return {
    values: Object.fromEntries(
      state.order.flatMap((id) => {
        const entry = state.entries[id];
        return entry ? [[id, { total: entry.total, owned: entry.owned }] as const] : [];
      }),
    ),
  };
}

function withHistory(state: ProgressState, entries: Record<string, ProgressEntry>): ProgressState {
  return {
    ...state,
    entries,
    history: [...state.history, snapshot(state)].slice(-state.historyLimit),
  };
}

function parseInput(
  input: string | number,
  field: ProgressField,
  fallback: number,
  maximum: number,
): { value: number; issue?: ProgressIssue } {
  const raw = String(input).trim();
  if (!raw) {
    return {
      value: fallback,
      issue: { field, code: "empty", message: "空输入已恢复为原值", input: raw },
    };
  }
  const normalizedSeparators = raw.replaceAll(",", "").replaceAll("_", "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalizedSeparators)) {
    return {
      value: fallback,
      issue: { field, code: "invalid", message: "输入不是有效数字，已恢复为原值", input: raw },
    };
  }
  const parsed = Number(normalizedSeparators);
  if (!Number.isFinite(parsed) || parsed > maximum) {
    return {
      value: maximum,
      issue: { field, code: "too-large", message: `数量已限制为 ${maximum}`, input: raw },
    };
  }
  if (parsed < 0) {
    return {
      value: 0,
      issue: { field, code: "negative", message: "数量不能为负数，已调整为 0", input: raw },
    };
  }
  const value = Math.floor(parsed);
  if (value !== parsed) {
    return {
      value,
      issue: { field, code: "fractional", message: "小数已向下取整", input: raw },
    };
  }
  return { value };
}

function updateEntry(
  entry: ProgressEntry,
  field: ProgressField,
  value: number,
  issue: ProgressIssue | undefined,
): ProgressEntry {
  let total = entry.total;
  let owned = entry.owned;
  if (field === "total") {
    total = value;
    owned = Math.min(owned, total);
  } else if (field === "owned") {
    owned = Math.min(value, total);
    if (value > total) {
      issue = {
        field,
        code: "clamped",
        message: "已经拥有不能超过总需求，已调整为总需求",
        input: String(value),
      };
    }
  } else {
    const remaining = Math.min(value, total);
    owned = total - remaining;
    if (value > total) {
      issue = {
        field,
        code: "clamped",
        message: "剩余需要不能超过总需求，已调整为总需求",
        input: String(value),
      };
    }
  }
  const remaining = total - owned;
  return {
    ...entry,
    total,
    owned,
    remaining,
    drafts: { total: String(total), owned: String(owned), remaining: String(remaining) },
    issues: issue ? [issue] : [],
  };
}

export function setProgressDraft(
  state: ProgressState,
  id: string,
  field: ProgressField,
  input: string,
): ProgressState {
  const entry = state.entries[id];
  if (!entry) return state;
  return {
    ...state,
    entries: {
      ...state.entries,
      [id]: { ...entry, drafts: { ...entry.drafts, [field]: input }, issues: [] },
    },
  };
}

export function updateProgress(
  state: ProgressState,
  id: string,
  field: ProgressField,
  input: string | number,
): ProgressState {
  const entry = state.entries[id];
  if (!entry) return state;
  const parsed = parseInput(input, field, entry[field], state.maxValue);
  const nextEntry = updateEntry(entry, field, parsed.value, parsed.issue);
  if (
    nextEntry.total === entry.total &&
    nextEntry.owned === entry.owned &&
    nextEntry.remaining === entry.remaining &&
    nextEntry.issues.length === 0
  ) {
    return state;
  }
  return withHistory(state, { ...state.entries, [id]: nextEntry });
}

export function commitProgressInput(
  state: ProgressState,
  id: string,
  field: ProgressField,
): ProgressState {
  const entry = state.entries[id];
  return entry ? updateProgress(state, id, field, entry.drafts[field]) : state;
}

function mapOwned(state: ProgressState, ownedFor: (entry: ProgressEntry) => number): ProgressState {
  const entries: Record<string, ProgressEntry> = Object.fromEntries(
    state.order.flatMap((id) => {
      const entry = state.entries[id];
      if (!entry) return [];
      const owned = Math.min(entry.total, clampInteger(ownedFor(entry), state.maxValue));
      const remaining = entry.total - owned;
      return [
        [
          id,
          {
            ...entry,
            owned,
            remaining,
            drafts: {
              total: String(entry.total),
              owned: String(owned),
              remaining: String(remaining),
            },
            issues: [] as ProgressIssue[],
          },
        ] as const,
      ];
    }),
  );
  return withHistory(state, entries);
}

export function batchResetOwned(state: ProgressState): ProgressState {
  return mapOwned(state, () => 0);
}

export const batchClearOwned = batchResetOwned;

export function batchComplete(state: ProgressState): ProgressState {
  return mapOwned(state, (entry) => entry.total);
}

export function undoProgress(state: ProgressState): ProgressState {
  const previous = state.history.at(-1);
  if (!previous) return state;
  const entries = { ...state.entries };
  for (const [id, values] of Object.entries(previous.values)) {
    const current = entries[id];
    if (current) entries[id] = createEntry(id, values.total, values.owned, state.maxValue);
  }
  return { ...state, entries, history: state.history.slice(0, -1) };
}

export function calculateOverallProgress(state: ProgressState): OverallProgress {
  let total = 0;
  let owned = 0;
  for (const entry of Object.values(state.entries)) {
    total += entry.total;
    owned += entry.owned;
  }
  total = Math.min(Number.MAX_SAFE_INTEGER, total);
  owned = Math.min(total, owned);
  const remaining = total - owned;
  const ratio = total === 0 ? 0 : owned / total;
  return { total, owned, remaining, ratio, percent: ratio * 100 };
}

export function ownedProgressRecord(state: ProgressState): Record<string, number> {
  return Object.fromEntries(
    state.order.flatMap((id) => {
      const entry = state.entries[id];
      return entry ? [[id, entry.owned] as const] : [];
    }),
  );
}
