import { useEffect } from "react";

// base.css paints the document body dark for the product pages. Light pages
// (marketing home, 404) set their own body background for their lifetime so
// overscroll regions and short documents show the page's canvas color, exactly
// as the legacy full-page documents did.
export function useBodyBackground(background: string): void {
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = background;
    return () => {
      document.body.style.background = previous;
    };
  }, [background]);
}
