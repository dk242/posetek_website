// Page-scoped port of the Microsoft Clarity loader embedded in the legacy
// page's <head>. Injected from this page's mount effect only (see PORTING.md);
// duplicated per page folder because pages own their folders.

type ClarityFn = { (...args: unknown[]): void; q?: unknown[][] };

const CLARITY_SRC = "https://www.clarity.ms/tag/w8lex8gzl7";

export function injectClarity(): void {
  const w = window as Window & { clarity?: ClarityFn };
  if (!w.clarity) {
    const queued: ClarityFn = (...args: unknown[]) => {
      queued.q = queued.q || [];
      queued.q.push(args);
    };
    w.clarity = queued;
  }
  if (document.querySelector(`script[src="${CLARITY_SRC}"]`)) return;
  const t = document.createElement("script");
  t.async = true;
  t.src = CLARITY_SRC;
  const y = document.getElementsByTagName("script")[0];
  if (y && y.parentNode) y.parentNode.insertBefore(t, y);
  else document.head.appendChild(t);
}
