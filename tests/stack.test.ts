import { describe, expect, it } from "vitest";
import { calculateStackBreakdown } from "../src/lib/stack";

describe("stack breakdown", () => {
  it.each([
    [0, 64, 0, 0, "0 个"],
    [5, 64, 0, 5, "5 个"],
    [64, 64, 1, 0, "1 组"],
    [128, 64, 2, 0, "2 组"],
    [129, 64, 2, 1, "2 组 + 1 个"],
    [33, 16, 2, 1, "2 组 + 1 个"],
    [5, 1, 5, 0, "5 个"],
  ])("calculates %i with stack size %i", (quantity, size, stacks, remainder, text) => {
    expect(calculateStackBreakdown(quantity, size)).toMatchObject({
      quantity,
      maxStackSize: size,
      fullStacks: stacks,
      remainder,
      text,
    });
  });

  it("normalizes quantities and reports an unknown stack size", () => {
    expect(calculateStackBreakdown(-2, 64).text).toBe("0 个");
    expect(calculateStackBreakdown(12.9, 64).quantity).toBe(12);
    expect(calculateStackBreakdown(9, null)).toMatchObject({
      maxStackSize: null,
      fullStacks: null,
      remainder: null,
      text: "无法计算",
    });
    expect(calculateStackBreakdown(9, 0).text).toBe("无法计算");
  });

  it("recalculates with a changed version stack size", () => {
    expect(calculateStackBreakdown(64, 64).text).toBe("1 组");
    expect(calculateStackBreakdown(64, 16).text).toBe("4 组");
  });
});
