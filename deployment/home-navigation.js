// Existing application bundles stay immutable. Enter the new home document
// when an application link or browser Back returns to its public route.
(() => {
  const isHome = path => path === "/" || path === "/index.html";
  let navigating = false;
  const reconcile = () => {
    if (!navigating && isHome(location.pathname)) { navigating = true; location.reload(); }
  };
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin || !isHome(target.pathname)) return;
    event.preventDefault(); event.stopPropagation(); navigating = true; location.assign(target.href);
  }, true);
  window.addEventListener("popstate", reconcile);
  window.addEventListener("pageshow", () => { navigating = false; reconcile(); });
  // Covers programmatic React Router navigation without patching history APIs.
  const root = document.getElementById("root");
  if (root) new MutationObserver(reconcile).observe(root, { childList: true, subtree: true });
  reconcile();
})();
