// Transitional entry for the preserved production app. It owns only the
// launcher element and routes document loads across the two app entry points.
// Remove when the production kick-comparison source is merged into this repo.
(() => {
  const plannerPath = "/admin/programs/personalized";
  const plannerShell = document.currentScript?.dataset.plannerShell === "personalized";
  const launcherId = "pt-personalized-planner-entry";
  const isPlanner = path => path.replace(/\/$/, "") === plannerPath;
  let navigating = false;
  let scheduled = false;
  let selectionRoute = "";
  let selectedIds = new Set();
  let restoreIds = new Set();
  let restoreOrg = "";

  function organizationSelect() {
    return [...document.querySelectorAll(".admin-heading label")]
      .find(label => label.querySelector("span")?.textContent.trim() === "Organization")?.querySelector("select");
  }

  function syncSelection() {
    if (!/^\/admin\/programs\/?$/.test(location.pathname)) return;
    const route = location.pathname + location.search;
    if (selectionRoute !== route) {
      selectionRoute = route;
      const query = new URLSearchParams(location.search);
      selectedIds = new Set((query.get("players") ?? "").split(",").filter(Boolean));
      restoreIds = new Set(selectedIds);
      restoreOrg = query.get("orgId") ?? "";
    }
    const org = organizationSelect();
    if (restoreOrg && org && !org.disabled && [...org.options].some(option => option.value === restoreOrg)) {
      const desired = restoreOrg;
      restoreOrg = "";
      if (org.value !== desired) {
        org.value = desired;
        org.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
    for (const checkbox of document.querySelectorAll('.admin-batch-row input[type="checkbox"][id^="batch-"]')) {
      const id = checkbox.id.slice(6);
      if (restoreIds.has(id) && !checkbox.disabled) {
        restoreIds.delete(id);
        if (!checkbox.checked) checkbox.click();
      }
      if (checkbox.checked) selectedIds.add(id);
      else if (!restoreIds.has(id)) selectedIds.delete(id);
    }
  }

  function plannerHref() {
    const query = new URLSearchParams();
    const current = new URLSearchParams(location.search);
    for (const key of ["orgId", "teamId", "players"]) {
      if (current.get(key)) query.set(key, current.get(key));
    }
    const player = location.pathname.match(/^\/admin\/accounts\/player\/([^/]+)\/?$/);
    if (player) query.set("players", decodeURIComponent(player[1]));
    const org = organizationSelect()?.value;
    if (org) query.set("orgId", org);
    if (/^\/admin\/programs\/?$/.test(location.pathname)) {
      query.delete("players");
      if (selectedIds.size) query.set("players", [...selectedIds].join(","));
    }
    return plannerPath + (query.size ? "?" + query : "");
  }

  function reconcile() {
    scheduled = false;
    if (navigating) return;
    // Also handles programmatic navigation and browser back/forward, while
    // ordinary cross-entry anchors are handled before React's click listener.
    if (plannerShell !== isPlanner(location.pathname)) {
      navigating = true;
      if (plannerShell && location.pathname === "/personalized-app/index.html") location.replace(plannerPath);
      else location.reload();
      return;
    }
    if (plannerShell) return;
    const eligible = /^\/admin\/?$/.test(location.pathname)
      || /^\/admin\/programs\/?$/.test(location.pathname)
      || /^\/admin\/accounts\/player\/[^/]+\/?$/.test(location.pathname);
    const admin = document.querySelector(".pt-admin");
    const shell = eligible && admin?.querySelector('nav[aria-label="Admin sections"]') && admin.querySelector(".admin-shell");
    let launcher = document.getElementById(launcherId);
    if (!shell) { launcher?.remove(); return; }
    syncSelection();
    if (!launcher || launcher.parentElement !== shell) {
      launcher?.remove();
      launcher = document.createElement("aside");
      launcher.id = launcherId;
      launcher.setAttribute("aria-label", "Personalized workout planner");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = "Personalized planner";
      const description = document.createElement("p");
      description.textContent = "Build from each player’s testing, compare a draft, then choose whether to use it.";
      copy.append(title, description);
      const link = document.createElement("a");
      link.textContent = "Open personalized planner";
      launcher.append(copy, link);
      shell.prepend(launcher);
    }
    const link = launcher.querySelector("a");
    if (organizationSelect()?.disabled) {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      return;
    }
    link.removeAttribute("aria-disabled");
    const href = plannerHref();
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }

  function schedule() {
    if (!scheduled) { scheduled = true; queueMicrotask(reconcile); }
  }
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor && event.isTrusted && event.target instanceof Element && event.target.closest("input,select,button")) {
      restoreIds.clear(); restoreOrg = "";
    }
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin || plannerShell === isPlanner(target.pathname)) return;
    event.preventDefault();
    event.stopPropagation();
    navigating = true;
    location.assign(target.href);
  }, true);
  window.addEventListener("popstate", schedule);
  window.addEventListener("pageshow", () => { navigating = false; schedule(); });
  document.addEventListener("change", schedule);
  new MutationObserver(schedule).observe(document.getElementById("root"), {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["class", "disabled", "checked", "selected", "value"],
  });
  reconcile();
})();
