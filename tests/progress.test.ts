import { describe, expect, it } from "vitest";
import {
  batchComplete,
  batchResetOwned,
  calculateOverallProgress,
  commitProgressInput,
  createProgressState,
  setProgressDraft,
  undoProgress,
  updateProgress,
} from "../src/lib/progress";

describe("three-column progress linkage", () => {
  it("updates total while retaining and then clamping owned", () => {
    let state = createProgressState([{ id: "stone", required: 10, owned: 7 }]);
    state = updateProgress(state, "stone", "total", 12);
    expect(state.entries.stone).toMatchObject({ total: 12, owned: 7, remaining: 5 });
    state = updateProgress(state, "stone", "total", 4);
    expect(state.entries.stone).toMatchObject({ total: 4, owned: 4, remaining: 0 });
  });

  it("updates owned and remaining in both directions", () => {
    let state = createProgressState({ stone: 20 });
    state = updateProgress(state, "stone", "owned", 8);
    expect(state.entries.stone).toMatchObject({ total: 20, owned: 8, remaining: 12 });
    state = updateProgress(state, "stone", "remaining", 3);
    expect(state.entries.stone).toMatchObject({ total: 20, owned: 17, remaining: 3 });
  });

  it("normalizes negatives, decimals, invalid text and large values", () => {
    let state = createProgressState({ stone: 10 }, { maxValue: 1000 });
    state = updateProgress(state, "stone", "owned", -5);
    expect(state.entries.stone?.owned).toBe(0);
    expect(state.entries.stone?.issues[0]?.code).toBe("negative");
    state = updateProgress(state, "stone", "total", "9.9");
    expect(state.entries.stone?.total).toBe(9);
    expect(state.entries.stone?.issues[0]?.code).toBe("fractional");
    state = updateProgress(state, "stone", "owned", "abc");
    expect(state.entries.stone?.owned).toBe(0);
    expect(state.entries.stone?.issues[0]?.code).toBe("invalid");
    state = updateProgress(state, "stone", "total", "999999999999999999999999");
    expect(state.entries.stone?.total).toBe(1000);
    expect(state.entries.stone?.issues[0]?.code).toBe("too-large");
  });

  it("clamps owned and remaining to total", () => {
    let state = createProgressState({ stone: 10 });
    state = updateProgress(state, "stone", "owned", 99);
    expect(state.entries.stone).toMatchObject({ owned: 10, remaining: 0 });
    state = updateProgress(state, "stone", "remaining", 99);
    expect(state.entries.stone).toMatchObject({ owned: 0, remaining: 10 });
  });

  it("allows an empty draft and restores the committed value on blur", () => {
    let state = createProgressState({ stone: 10 });
    state = setProgressDraft(state, "stone", "total", "");
    expect(state.entries.stone?.drafts.total).toBe("");
    state = commitProgressInput(state, "stone", "total");
    expect(state.entries.stone).toMatchObject({ total: 10, remaining: 10 });
    expect(state.entries.stone?.drafts.total).toBe("10");
    expect(state.entries.stone?.issues[0]?.code).toBe("empty");
  });

  it("does bulk reset/complete as one undoable operation", () => {
    let state = createProgressState([
      { id: "stone", required: 10, owned: 2 },
      { id: "glass", required: 5, owned: 1 },
    ]);
    state = batchComplete(state);
    expect(state.entries.stone?.owned).toBe(10);
    expect(state.entries.glass?.owned).toBe(5);
    state = undoProgress(state);
    expect(state.entries.stone?.owned).toBe(2);
    expect(state.entries.glass?.owned).toBe(1);
    state = batchResetOwned(state);
    expect(state.entries.stone?.owned).toBe(0);
    expect(state.entries.glass?.owned).toBe(0);
  });

  it("computes completion by item quantity rather than material kinds", () => {
    let state = createProgressState({ common: 99, rare: 1 });
    state = updateProgress(state, "rare", "owned", 1);
    expect(calculateOverallProgress(state)).toMatchObject({
      total: 100,
      owned: 1,
      remaining: 99,
      percent: 1,
    });
  });
});
