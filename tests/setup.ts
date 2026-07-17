import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
  });
}
