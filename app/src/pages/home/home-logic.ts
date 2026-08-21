// Pure logic ported from the inline <script> of legacy index.html.

/** Legacy: `(currentIndex + 1) % slides.length` — the 3s auto-advance step. */
export function nextSlideIndex(current: number, count: number): number {
  return (current + 1) % count;
}

/**
 * Legacy `updateScrollIndicators()`:
 *   const pastHero = scrollY > heroH * 0.45;
 *   scrollUpBtn visible   = pastHero
 *   scrollDownBtn visible = pastHero && scrollY < maxScroll - 80
 */
export function scrollIndicatorVisibility(
  scrollY: number,
  heroHeight: number,
  maxScroll: number,
): { up: boolean; down: boolean } {
  const pastHero = scrollY > heroHeight * 0.45;
  return { up: pastHero, down: pastHero && scrollY < maxScroll - 80 };
}

/**
 * Legacy scrollUp click: `[...snapSections].reverse().find(s => s.offsetTop < scrollY - 80)`.
 * Returns the index of the matching section, or -1 when there is none.
 */
export function findPreviousSection(offsets: number[], scrollY: number): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (offsets[i] < scrollY - 80) return i;
  }
  return -1;
}

/**
 * Legacy scrollDown click: `snapSections.find(s => s.offsetTop > scrollY + 80)`.
 * Returns the index of the matching section, or -1 when there is none.
 */
export function findNextSection(offsets: number[], scrollY: number): number {
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > scrollY + 80) return i;
  }
  return -1;
}
