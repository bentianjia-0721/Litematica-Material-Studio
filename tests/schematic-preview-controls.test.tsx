import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SchematicPreview } from "../src/features/schematic-preview/SchematicPreview";
import type { LitematicPreview } from "../src/lib/litematic";

const emptyPreview: LitematicPreview = {
  states: [],
  positions: new Int32Array(),
  stateIndices: new Uint32Array(),
  bounds: null,
  totalBlockCount: 0,
  sampledBlockCount: 0,
  truncated: false,
};

describe("schematic preview controls", () => {
  it("keeps layer choices selectable while camera actions remain momentary buttons", () => {
    render(<SchematicPreview preview={emptyPreview} minecraftVersion="1.21.1" />);

    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "单层" })).toHaveAttribute("aria-pressed", "false");

    for (const name of ["放大", "缩小", "重置", "顶视", "全屏"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("aria-pressed");
      expect(button).not.toHaveAttribute("role", "switch");
    }
  });
});
