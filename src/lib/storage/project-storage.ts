import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const PROJECT_PROGRESS_SCHEMA_VERSION = 1 as const;

export interface ProjectProgressRecord {
  schemaVersion: typeof PROJECT_PROGRESS_SCHEMA_VERSION;
  projectId: string;
  fileName?: string;
  fileSize?: number;
  owned: Record<string, number>;
  createdAt?: string;
  updatedAt: string;
}

interface ProjectStorageDatabase extends DBSchema {
  projects: {
    key: string;
    value: ProjectProgressRecord;
    indexes: { "by-updated": string };
  };
}

export type StorageBackend = "indexeddb" | "localstorage" | "memory";

export interface ProjectStorageOptions {
  dbName?: string;
  localStoragePrefix?: string;
  forceBackend?: StorageBackend;
}

export interface ProjectStorage {
  readonly backend: StorageBackend;
  save(record: ProjectProgressRecord): Promise<ProjectProgressRecord>;
  load(projectId: string): Promise<ProjectProgressRecord | null>;
  delete(projectId: string): Promise<void>;
  list(): Promise<ProjectProgressRecord[]>;
  clear(): Promise<void>;
  close(): void;
}

function cloneRecord(record: ProjectProgressRecord): ProjectProgressRecord {
  return {
    ...record,
    owned: { ...record.owned },
  };
}

function normalizeOwned(owned: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(owned).map(([id, quantity]) => [
      id,
      Number.isFinite(quantity) && quantity > 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(quantity))
        : 0,
    ]),
  );
}

function normalizeRecord(record: ProjectProgressRecord): ProjectProgressRecord {
  if (!record.projectId.trim()) throw new Error("projectId must not be empty");
  return {
    ...record,
    schemaVersion: PROJECT_PROGRESS_SCHEMA_VERSION,
    projectId: record.projectId.trim(),
    owned: normalizeOwned(record.owned),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is ProjectProgressRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ProjectProgressRecord>;
  return (
    record.schemaVersion === PROJECT_PROGRESS_SCHEMA_VERSION &&
    typeof record.projectId === "string" &&
    typeof record.updatedAt === "string" &&
    Boolean(record.owned) &&
    typeof record.owned === "object"
  );
}

function parseStoredJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

class BrowserProjectStorage implements ProjectStorage {
  #backend: StorageBackend;
  #dbPromise: Promise<IDBPDatabase<ProjectStorageDatabase>> | null = null;
  readonly #dbName: string;
  readonly #prefix: string;
  readonly #memory = new Map<string, ProjectProgressRecord>();

  constructor(options: ProjectStorageOptions) {
    this.#dbName = options.dbName ?? "litematica-material-studio";
    this.#prefix = options.localStoragePrefix ?? "litematica-material-studio:progress:";
    this.#backend =
      options.forceBackend ??
      (typeof globalThis.indexedDB !== "undefined"
        ? "indexeddb"
        : this.localStorageAvailable()
          ? "localstorage"
          : "memory");
  }

  get backend(): StorageBackend {
    return this.#backend;
  }

  private localStorageAvailable(): boolean {
    try {
      return typeof globalThis.localStorage !== "undefined";
    } catch {
      return false;
    }
  }

  private localStorage(): Storage {
    return globalThis.localStorage;
  }

  private database(): Promise<IDBPDatabase<ProjectStorageDatabase>> {
    this.#dbPromise ??= openDB<ProjectStorageDatabase>(this.#dbName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("projects")) {
          const store = database.createObjectStore("projects", { keyPath: "projectId" });
          store.createIndex("by-updated", "updatedAt");
        }
      },
    });
    return this.#dbPromise;
  }

  private degrade(): void {
    this.#dbPromise?.then((database) => database.close()).catch(() => undefined);
    this.#dbPromise = null;
    this.#backend =
      this.#backend === "indexeddb" && this.localStorageAvailable() ? "localstorage" : "memory";
  }

  async save(record: ProjectProgressRecord): Promise<ProjectProgressRecord> {
    const normalized = normalizeRecord(record);
    try {
      if (this.#backend === "indexeddb") {
        await (await this.database()).put("projects", normalized);
      } else if (this.#backend === "localstorage") {
        this.localStorage().setItem(
          `${this.#prefix}${normalized.projectId}`,
          JSON.stringify(normalized),
        );
      } else {
        this.#memory.set(normalized.projectId, cloneRecord(normalized));
      }
      return cloneRecord(normalized);
    } catch {
      this.degrade();
      return this.save(normalized);
    }
  }

  async load(projectId: string): Promise<ProjectProgressRecord | null> {
    try {
      let value: unknown;
      if (this.#backend === "indexeddb") {
        value = await (await this.database()).get("projects", projectId);
      } else if (this.#backend === "localstorage") {
        const serialized = this.localStorage().getItem(`${this.#prefix}${projectId}`);
        value = serialized ? parseStoredJson(serialized) : null;
      } else {
        value = this.#memory.get(projectId) ?? null;
      }
      return isRecord(value) ? cloneRecord(normalizeRecord(value)) : null;
    } catch {
      this.degrade();
      return this.load(projectId);
    }
  }

  async delete(projectId: string): Promise<void> {
    try {
      if (this.#backend === "indexeddb") {
        await (await this.database()).delete("projects", projectId);
      } else if (this.#backend === "localstorage") {
        this.localStorage().removeItem(`${this.#prefix}${projectId}`);
      } else {
        this.#memory.delete(projectId);
      }
    } catch {
      this.degrade();
      await this.delete(projectId);
    }
  }

  async list(): Promise<ProjectProgressRecord[]> {
    try {
      let values: unknown[];
      if (this.#backend === "indexeddb") {
        values = await (await this.database()).getAllFromIndex("projects", "by-updated");
      } else if (this.#backend === "localstorage") {
        const storage = this.localStorage();
        values = Array.from({ length: storage.length }, (_, index) => storage.key(index))
          .filter((key): key is string => Boolean(key?.startsWith(this.#prefix)))
          .map((key) => storage.getItem(key))
          .filter((value): value is string => value !== null)
          .map(parseStoredJson);
      } else {
        values = [...this.#memory.values()];
      }
      return values
        .filter(isRecord)
        .map((record) => cloneRecord(normalizeRecord(record)))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch {
      this.degrade();
      return this.list();
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.#backend === "indexeddb") {
        await (await this.database()).clear("projects");
      } else if (this.#backend === "localstorage") {
        const storage = this.localStorage();
        const keys = Array.from({ length: storage.length }, (_, index) =>
          storage.key(index),
        ).filter((key): key is string => Boolean(key?.startsWith(this.#prefix)));
        for (const key of keys) storage.removeItem(key);
      } else {
        this.#memory.clear();
      }
    } catch {
      this.degrade();
      await this.clear();
    }
  }

  close(): void {
    this.#dbPromise?.then((database) => database.close()).catch(() => undefined);
    this.#dbPromise = null;
  }
}

export function createProjectStorage(options: ProjectStorageOptions = {}): ProjectStorage {
  return new BrowserProjectStorage(options);
}

let defaultStorage: ProjectStorage | undefined;

function storage(): ProjectStorage {
  defaultStorage ??= createProjectStorage();
  return defaultStorage;
}

export async function saveProjectProgress(
  record: ProjectProgressRecord,
): Promise<ProjectProgressRecord> {
  return storage().save(record);
}

export async function loadProjectProgress(
  projectId: string,
): Promise<ProjectProgressRecord | null> {
  return storage().load(projectId);
}

export async function deleteProjectProgress(projectId: string): Promise<void> {
  return storage().delete(projectId);
}

export async function listProjectProgress(): Promise<ProjectProgressRecord[]> {
  return storage().list();
}

export async function clearAllProjectProgress(): Promise<void> {
  return storage().clear();
}

export const saveProgress = saveProjectProgress;
export const loadProgress = loadProjectProgress;
