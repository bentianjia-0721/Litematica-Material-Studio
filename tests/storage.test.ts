import { describe, expect, it } from "vitest";
import { createProjectStorage, fileHash } from "../src/lib/storage";

const record = {
  schemaVersion: 1 as const,
  projectId: "project-a",
  fileName: "castle.litematic",
  fileSize: 123,
  owned: { "minecraft:stone": 12 },
  updatedAt: "2026-07-16T00:00:00.000Z",
};

describe("fileHash", () => {
  it("is stable for equal bytes and changes for different bytes", async () => {
    const first = await fileHash(new TextEncoder().encode("same"));
    const second = await fileHash(new Blob(["same"]));
    const different = await fileHash("different");
    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^(?:sha256|fnv1a64)-[0-9a-f]+$/u);
  });
});

describe("project progress storage", () => {
  it("saves, lists, loads and deletes without storing the file body", async () => {
    const storage = createProjectStorage({ forceBackend: "memory" });
    await storage.save(record);
    const loaded = await storage.load(record.projectId);
    expect(loaded).toEqual(record);
    expect(loaded).not.toHaveProperty("file");
    expect(await storage.list()).toEqual([record]);
    await storage.delete(record.projectId);
    expect(await storage.load(record.projectId)).toBeNull();
  });

  it("persists through IndexedDB when available", async () => {
    const name = `litematica-test-${crypto.randomUUID()}`;
    const first = createProjectStorage({ dbName: name, forceBackend: "indexeddb" });
    await first.save(record);
    const second = createProjectStorage({ dbName: name, forceBackend: "indexeddb" });
    expect(await second.load(record.projectId)).toEqual(record);
    await second.clear();
    first.close();
    second.close();
  });

  it("uses localStorage when explicitly selected", async () => {
    const prefix = `litematica-test-${crypto.randomUUID()}:`;
    const storage = createProjectStorage({
      forceBackend: "localstorage",
      localStoragePrefix: prefix,
    });
    await storage.save(record);
    expect(storage.backend).toBe("localstorage");
    expect(await storage.load(record.projectId)).toEqual(record);
    await storage.clear();
  });

  it("degrades after an IndexedDB failure", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      const storage = createProjectStorage({
        forceBackend: "indexeddb",
        localStoragePrefix: `litematica-fallback-${crypto.randomUUID()}:`,
      });
      await storage.save(record);
      expect(["localstorage", "memory"]).toContain(storage.backend);
      expect(await storage.load(record.projectId)).toEqual(record);
      await storage.clear();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    }
  });
});
