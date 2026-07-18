import { useLayoutEffect } from "react";

export function scrollPageToTop(): void {
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

export function useScrollToPageTop(active: boolean): void {
  useLayoutEffect(() => {
    if (active) scrollPageToTop();
  }, [active]);
}
