import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("keeps layer choices selectable, the resource pack as a switch, and camera actions momentary", async () => {
    const user = userEvent.setup();
    const { container } = render(<SchematicPreview preview={emptyPreview} />);

    expect(screen.getByText("SCHEMATIC VIEWER")).toBeInTheDocument();
    expect(screen.queryByText("TEST · SCHEMATIC VIEWER")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "单层" })).toHaveAttribute("aria-pressed", "false");

    for (const name of ["放大", "缩小", "重置", "顶视", "全屏"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("aria-pressed");
      expect(button).not.toHaveAttribute("role", "switch");
    }

    const xkrdSwitch = screen.getByRole("switch", { name: "启用 XK 红显" });
    expect(xkrdSwitch).not.toBeChecked();
    await user.click(xkrdSwitch);
    expect(xkrdSwitch).toBeChecked();
    expect(screen.getByText("已开启")).toBeInTheDocument();

    expect(container.querySelector(".preview-resource-status")).toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
