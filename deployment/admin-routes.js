// Shared by the document bridge and route tests. The preserved app owns the
// newer analysis/results workspaces until their source is recovered.
export function usesRefreshedAdmin(path) {
  if (!/^\/admin(?:\/|$)/.test(path)) return false;
  if (/^\/admin\/analysis(?:\/|$)/.test(path)) return false;
  if (/^\/admin\/accounts\/player\/[^/]+\/results(?:\/|$)/.test(path)) return false;
  return true;
}
