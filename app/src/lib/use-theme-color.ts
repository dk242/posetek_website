import { useEffect } from "react";

// The SPA shell (app/index.html) declares a dark theme-color for the product
// pages. Light legacy pages (marketing home, 404) declared none, so mobile
// browser chrome stayed light there. Pages call useThemeColor(null) to remove
// the meta while mounted (restoring the browser default), or pass a color to
// override it; the previous value comes back on unmount.
export function useThemeColor(color: string | null): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const previous = meta.getAttribute("content");
    if (color === null) meta.removeAttribute("content");
    else meta.setAttribute("content", color);
    return () => {
      if (previous === null) meta.removeAttribute("content");
      else meta.setAttribute("content", previous);
    };
  }, [color]);
}
