import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollToPageTop } from "../src/app/use-scroll-to-page-top";

function ScrollHarness({ active }: { active: boolean }) {
  useScrollToPageTop(active);
  return null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("result page scroll restoration", () => {
  it("scrolls to the page top exactly once when the result page becomes active", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    document.documentElement.scrollTop = 720;
    document.documentElement.scrollLeft = 40;
    document.body.scrollTop = 720;
    document.body.scrollLeft = 40;

    const { rerender } = render(<ScrollHarness active={false} />);
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<ScrollHarness active />);

    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.documentElement.scrollLeft).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(document.body.scrollLeft).toBe(0);

    rerender(<ScrollHarness active />);
    expect(scrollTo).toHaveBeenCalledOnce();
  });
});
