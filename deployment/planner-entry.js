// Transitional document bridge. Refreshed admin pages share one React app;
// the preserved app retains the newer analysis/results tools and public site.
import { usesRefreshedAdmin } from "./admin-routes.js";

const adminShell = document.querySelector('script[data-planner-shell]')?.dataset.plannerShell === "personalized";
let navigating = false;
let scheduled = false;

function reconcile() {
  scheduled = false;
  if (navigating) return;
  if (adminShell !== usesRefreshedAdmin(location.pathname)) {
    navigating = true;
    if (adminShell && location.pathname === "/personalized-app/index.html") location.replace("/admin/programs/personalized");
    else location.reload();
    return;
  }
  if (!adminShell) refreshPreservedHeader();
}
function schedule() {
  if (!scheduled) { scheduled = true; queueMicrotask(reconcile); }
}
document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
  const target = new URL(anchor.href, location.href);
  if (target.origin !== location.origin || adminShell === usesRefreshedAdmin(target.pathname)) return;
  event.preventDefault();
  event.stopPropagation();
  navigating = true;
  location.assign(target.href);
}, true);
window.addEventListener("popstate", schedule);
window.addEventListener("pageshow", () => { navigating = false; schedule(); });
new MutationObserver(schedule).observe(document.getElementById("root"), {
  childList: true, subtree: true, characterData: true,
});
reconcile();

// Only add labels and an owned mobile shortcut; leave React's links/handlers
// intact. Shared source styles also theme the preserved analysis workspace.
function refreshPreservedHeader() {
  const admin = document.querySelector(".pt-admin");
  const nav = admin?.querySelector('nav[aria-label="Admin sections"]');
  const right = admin?.querySelector(".admin-header-right");
  const id = "pt-admin-technique-shortcut";
  if (!nav || !right) { document.getElementById(id)?.remove(); return; }
  for (const [path, short] of Object.entries({ drills: "Drills", organizations: "Organizations", accounts: "Accounts", programs: "Programs" })) {
    const link = nav.querySelector('a[href="/admin/' + path + '"]');
    if (link) {
      link.setAttribute("aria-label", short);
      link.dataset.adminShort = short;
    }
  }
  let shortcut = document.getElementById(id);
  if (!shortcut) {
    shortcut = document.createElement("a");
    shortcut.id = id;
    shortcut.className = "quiet-button admin-technique-link";
    shortcut.href = "/admin/analysis";
    shortcut.setAttribute("aria-label", "Technique review");
    shortcut.title = "Technique review";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "edit_note";
    shortcut.append(icon);
    right.prepend(shortcut);
  }
  if (/^\/admin\/analysis(?:\/|$)/.test(location.pathname)) shortcut.setAttribute("aria-current", "page");
  else shortcut.removeAttribute("aria-current");
}
