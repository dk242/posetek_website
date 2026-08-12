(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs",
    authDomain: "kickai-69dd0.firebaseapp.com",
    projectId: "kickai-69dd0",
    storageBucket: "kickai-69dd0.firebasestorage.app",
    messagingSenderId: "839600313930",
    appId: "1:839600313930:web:13b1e94c2c540561e3f8b3",
    measurementId: "G-RX99K62ZEH"
  };

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();
  const cloudFunctions = firebase.functions();

  const configs = {
    broadJump: {
      key: "broadJump",
      title: "Broad Jump",
      eyebrow: "Power · Horizontal jump",
      page: "broadJumpPage.html",
      siblingPage: "changeOfDirectionPage.html",
      primaryField: "broadJumpDistance",
      primaryLabel: "Distance",
      bestLabel: "Best distance",
      averageLabel: "Average distance",
      chartLabel: "Distance (ft)",
      lowerIsBetter: false,
      emptyText: "No broad-jump results have been recorded for this athlete yet.",
      artifacts: ["pose.json", "metadata.json", "foot_piecewise_fit.json", "key_frames.json", "foot_centers.json", "com_midpoints.json", "com_height.json"]
    },
    changeOfDirection: {
      key: "changeOfDirection",
      title: "Change of Direction",
      eyebrow: "Agility · Shuttle test",
      page: "changeOfDirectionPage.html",
      siblingPage: "broadJumpPage.html",
      primaryField: "totalTime",
      primaryLabel: "Shuttle time",
      bestLabel: "Best time",
      averageLabel: "Average time",
      chartLabel: "Time (s)",
      lowerIsBetter: true,
      emptyText: "No change-of-direction results have been recorded for this athlete yet.",
      artifacts: ["pose.json", "metadata.json"]
    }
  };

  const drillKey = document.body.dataset.drill;
  const config = configs[drillKey];
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  const state = {
    viewer: null,
    player: null,
    reps: [],
    currentRep: null,
    artifacts: {},
    frames: [],
    currentFrame: 0,
    playing: false,
    speed: 0.5,
    animationId: 0,
    lastTick: 0,
    frameAccumulator: 0,
    chart: null,
    resizeObserver: null,
    preview: false,
    shareToken: null,
    shareExpiresAtMillis: null
  };

  const skeleton33 = [
    [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
    [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
    [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
    [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
    [24,26],[26,28],[28,30],[30,32],[28,32]
  ];
  const skeleton17 = [
    [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
    [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]
  ];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function asNumber(value) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function asInteger(value) {
    const number = asNumber(value);
    return number === null ? null : Math.round(number);
  }

  function timestampMillis(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && typeof value.seconds === "number") return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDate(millis) {
    if (!millis) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(millis));
  }

  function metersToFeet(value) { return value * 3.28084; }
  function metersToInches(value) { return value * 39.37007874; }

  function formatPrimary(raw) {
    const value = asNumber(raw);
    if (value === null) return "—";
    return config.key === "broadJump" ? `${metersToFeet(value).toFixed(1)} ft` : `${value.toFixed(2)} s`;
  }

  function showLoading(message = "Loading athlete results…") {
    app.innerHTML = `<section class="loading-screen"><div><div class="spinner"></div><p>${escapeHtml(message)}</p></div></section>`;
  }

  function showError(title, message) {
    stopPlayback();
    app.innerHTML = `<section class="error-panel"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></section>`;
  }

  function currentReturnTarget() {
    const fileName = location.pathname.split("/").pop() || config.page;
    return `${fileName}${location.search}`;
  }

  function redirectToLogin() {
    const target = encodeURIComponent(currentReturnTarget());
    location.replace(`kickai.html?returnTo=${target}`);
  }

  async function firstQuery(collectionName, field, value) {
    if (!value) return null;
    const snapshot = await db.collection(collectionName).where(field, "==", value).limit(1).get();
    return snapshot.empty ? null : snapshot.docs[0];
  }

  async function resolveViewer(user) {
    let coachDoc = await db.collection("coaches").doc(user.uid).get();
    if (!coachDoc.exists) coachDoc = await firstQuery("coaches", "userUID", user.uid);
    if (coachDoc && coachDoc.exists) {
      return { role: "coach", uid: user.uid, docId: coachDoc.id, data: coachDoc.data() || {} };
    }

    const candidates = [];
    if (user.email) {
      candidates.push(["signupEmail", user.email]);
      const lower = user.email.toLowerCase();
      if (lower !== user.email) candidates.push(["signupEmail", lower]);
    }
    candidates.push(["authenticationUID", user.uid], ["userUID", user.uid]);

    let playerDoc = null;
    for (const [field, value] of candidates) {
      playerDoc = await firstQuery("players", field, value);
      if (playerDoc) break;
    }
    if (!playerDoc) {
      const direct = await db.collection("players").doc(user.uid).get();
      if (direct.exists) playerDoc = direct;
    }
    if (!playerDoc || !playerDoc.exists) {
      throw new Error("Your login is valid, but it is not linked to an athlete profile yet. Ask your coach to connect this Auth ID to the player profile.");
    }
    return { role: "player", uid: user.uid, docId: playerDoc.id, data: playerDoc.data() || {} };
  }

  async function resolveAuthorizedPlayer(viewer) {
    const requestedId = params.get("player");
    if (viewer.role === "player") {
      if (requestedId && requestedId !== viewer.docId) {
        throw new Error("This link belongs to a different athlete account. Sign in with the account associated with this result.");
      }
      return { id: viewer.docId, data: viewer.data };
    }

    if (!requestedId) {
      throw new Error("This coach link is missing a player. Open the athlete from your roster, then copy their results link.");
    }

    const playerDoc = await db.collection("players").doc(requestedId).get();
    if (!playerDoc.exists) throw new Error("The athlete profile in this link no longer exists.");
    const playerData = playerDoc.data() || {};
    const members = Array.isArray(viewer.data.members) ? viewer.data.members : [];
    const linkedCoachIds = [playerData.coachUID, playerData.coachId, playerData.coachDocId].filter(Boolean);
    const authorized = members.includes(requestedId) || linkedCoachIds.includes(viewer.uid) || linkedCoachIds.includes(viewer.docId);
    if (!authorized) throw new Error("This athlete is not on your roster, so their results cannot be opened from this account.");
    return { id: playerDoc.id, data: playerData };
  }

  async function loadReps(playerId) {
    const repsRef = db.collection("players").doc(playerId).collection("reps");
    let snapshot = await repsRef.where("repType", "==", config.key).get();
    if (snapshot.empty) snapshot = await repsRef.where("drillType", "==", config.key).get();

    const seen = new Set();
    const reps = [];
    snapshot.docs.forEach(doc => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      const data = doc.data() || {};
      const primary = asNumber(data[config.primaryField]);
      reps.push({
        id: doc.id,
        ...data,
        primary,
        createdAtMillis: timestampMillis(data.createdAt),
        sessionNumber: asInteger(data.sessionNumber) || 1,
        repNumber: asInteger(data.repNumber) || asInteger(data.absoluteRepNumber) || 1,
        absoluteRepNumber: asInteger(data.absoluteRepNumber)
      });
    });
    reps.sort((a, b) => (b.createdAtMillis - a.createdAtMillis) || ((b.absoluteRepNumber || 0) - (a.absoluteRepNumber || 0)));
    return reps;
  }

  function athleteName() {
    const data = state.player?.data || {};
    const name = [data.firstName, data.lastName].filter(Boolean).join(" ").trim();
    return name || data.name || "Athlete";
  }

  function pageUrl(page, extra = {}) {
    const query = new URLSearchParams();
    if (state.shareToken) {
      query.set("share", state.shareToken);
    } else {
      if (state.player?.id) query.set("player", state.player.id);
      query.set("userType", state.viewer?.role || "player");
    }
    Object.entries(extra).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") query.set(key, value);
    });
    return `${page}?${query.toString()}`;
  }

  function renderShell() {
    const values = state.reps.map(rep => rep.primary).filter(value => value !== null);
    const best = values.length ? (config.lowerIsBetter ? Math.min(...values) : Math.max(...values)) : null;
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const siblingTitle = config.key === "broadJump" ? "Change of Direction" : "Broad Jump";

    app.innerHTML = `
      <section class="page-intro">
        <div>
          <p class="eyebrow">${escapeHtml(config.eyebrow)}</p>
          <h1>${escapeHtml(config.title)}</h1>
          <p class="athlete-line"><strong>${escapeHtml(athleteName())}</strong> · ${state.reps.length ? `Latest test ${escapeHtml(formatDate(state.reps[0].createdAtMillis))}` : "Awaiting first test"}</p>
        </div>
        <nav class="drill-switcher" aria-label="Athlete tests">
          <a class="active" href="${escapeHtml(pageUrl(config.page))}">${escapeHtml(config.title)}</a>
          <a href="${escapeHtml(pageUrl(config.siblingPage))}">${escapeHtml(siblingTitle)}</a>
        </nav>
      </section>
      <div id="validationBanner" class="validation-banner hidden"><span class="material-symbols-outlined">warning</span><span id="validationMessage"></span></div>
      <section class="summary-grid" aria-label="Performance summary">
        <article class="summary-card"><span class="summary-value">${escapeHtml(formatPrimary(best))}</span><span class="summary-label">${escapeHtml(config.bestLabel)}</span></article>
        <article class="summary-card"><span class="summary-value">${escapeHtml(formatPrimary(average))}</span><span class="summary-label">${escapeHtml(config.averageLabel)}</span></article>
        <article class="summary-card"><span class="summary-value">${state.reps.length}</span><span class="summary-label">Recorded reps</span></article>
      </section>
      ${state.reps.length ? renderResultsContent() : `<section class="empty-panel"><h2>No results yet</h2><p>${escapeHtml(config.emptyText)}</p></section>`}
    `;

    const dashboardLink = document.getElementById("dashboardLink");
    const copyButton = document.getElementById("copyLinkButton");
    const brandLink = document.querySelector(".brand");
    if (brandLink && state.viewer?.role === "shared") brandLink.href = pageUrl(config.page);
    if (dashboardLink) {
      dashboardLink.classList.toggle("hidden", state.viewer?.role === "shared");
      if (state.viewer?.role !== "shared") dashboardLink.href = pageUrl("kickingview.html");
    }
    if (copyButton) copyButton.classList.toggle("hidden", state.viewer?.role !== "coach");
    bindStaticEvents();
    if (state.reps.length) {
      renderChart();
      selectInitialRep();
    }
  }

  function renderResultsContent() {
    return `
      <section class="panel">
        <div class="panel-header"><div><h2 class="panel-title">Performance history</h2><p class="panel-subtitle">Select any result to open its detailed rep viewer.</p></div></div>
        <div class="history-layout">
          <div class="chart-wrap"><canvas id="historyChart"></canvas></div>
          <div id="historyList" class="history-list">${state.reps.map(rep => `
            <button class="history-row" type="button" data-rep-id="${escapeHtml(rep.id)}">
              <span>Session ${rep.sessionNumber} · Rep ${rep.repNumber}<small>${escapeHtml(formatDate(rep.createdAtMillis))}</small></span>
              <span class="history-value">${escapeHtml(formatPrimary(rep.primary))}</span>
            </button>`).join("")}</div>
        </div>
      </section>
      <section class="panel" id="repPanel">
        <div class="panel-header"><div><h2 class="panel-title">Rep analysis</h2><p id="repSubtitle" class="panel-subtitle">Loading rep artifacts…</p></div></div>
        <div id="repStrip" class="rep-strip">${state.reps.map(rep => `<button class="rep-button" type="button" data-rep-id="${escapeHtml(rep.id)}">S${rep.sessionNumber} · R${rep.repNumber}</button>`).join("")}</div>
        <div id="repLoading" class="loading-screen" style="min-height:300px"><div><div class="spinner"></div><p>Loading pose and metrics…</p></div></div>
        <div id="repContent" class="hidden"></div>
      </section>
    `;
  }

  function bindStaticEvents() {
    document.querySelectorAll("[data-rep-id]").forEach(button => {
      button.addEventListener("click", () => selectRep(button.dataset.repId));
    });
    const copyButton = document.getElementById("copyLinkButton");
    if (copyButton) copyButton.onclick = copyAthleteLink;
  }

  async function copyAthleteLink() {
    if (!state.player) return;
    if (state.preview) {
      const previewUrl = new URL(config.page, location.href);
      previewUrl.search = "?preview=1";
      await copyResultUrl(previewUrl.toString());
      return;
    }
    if (state.viewer?.role !== "coach") return;
    const button = document.getElementById("copyLinkButton");
    const label = button?.querySelector(".label");
    if (button) button.disabled = true;
    if (label) label.textContent = "Creating secure linkâ€¦";
    try {
      const createShare = cloudFunctions.httpsCallable("createAthleteResultsShare");
      const response = await createShare({ playerDocId: state.player.id });
      const token = response?.data?.token;
      if (!token) throw new Error("The secure link could not be created.");
      const url = new URL(config.page, location.href);
      url.search = "";
      url.searchParams.set("share", token);
      await copyResultUrl(url.toString());
    } catch (error) {
      console.error("[athlete-share] create failed", error);
      window.alert(error?.message || "The secure results link could not be created.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function copyResultUrl(url) {
    const button = document.getElementById("copyLinkButton");
    const label = button?.querySelector(".label");
    try {
      await navigator.clipboard.writeText(String(url));
      if (label) label.textContent = "Secure link copied";
    } catch (_) {
      window.prompt("Copy this athlete results link:", String(url));
    }
    setTimeout(() => { if (label) label.textContent = "Copy secure results link"; }, 1800);
  }

  function renderChart() {
    const canvas = document.getElementById("historyChart");
    if (!canvas || typeof Chart === "undefined") return;
    const chronological = [...state.reps].reverse().filter(rep => rep.primary !== null);
    const chartValues = chronological.map(rep => config.key === "broadJump" ? metersToFeet(rep.primary) : rep.primary);
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: chronological.map(rep => `S${rep.sessionNumber} R${rep.repNumber}`),
        datasets: [{
          label: config.chartLabel,
          data: chartValues,
          borderColor: "#63b487",
          backgroundColor: "rgba(99,180,135,0.16)",
          pointBackgroundColor: "#f7fbf9",
          pointBorderColor: "#3f8e66",
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          tension: 0.28,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "rgba(255,255,255,0.65)" } },
          y: { beginAtZero: false, grid: { color: "rgba(255,255,255,0.08)" }, ticks: { color: "rgba(255,255,255,0.65)" }, title: { display: true, text: config.chartLabel, color: "rgba(255,255,255,0.65)" } }
        }
      }
    });
  }

  function selectInitialRep() {
    const sessionParam = String(params.get("session") || "").replace(/\D/g, "");
    const repParam = String(params.get("rep") || params.get("kick") || "").replace(/\D/g, "");
    const match = state.reps.find(rep =>
      (!sessionParam || rep.sessionNumber === Number(sessionParam)) &&
      (!repParam || rep.repNumber === Number(repParam))
    );
    selectRep((match || state.reps[0]).id);
  }

  function folderCandidates(rep) {
    const folders = [];
    const path = typeof rep.storagePath === "string" ? rep.storagePath.replace(/\\/g, "/") : "";
    if (path && !/^https?:/i.test(path)) {
      const clean = path.replace(/^gs:\/\/[^/]+\//i, "").split("?")[0].replace(/^\/+|\/+$/g, "");
      const pieces = clean.split("/");
      if (/\.(mov|mp4)$/i.test(pieces[pieces.length - 1] || "")) pieces.pop();
      if (pieces.length) folders.push(pieces.join("/"));
    }
    folders.push(`${state.player.id}/${config.key}/session${rep.sessionNumber}/kick${rep.repNumber}`);
    return [...new Set(folders.filter(Boolean))];
  }

  async function fetchStorageJson(path) {
    const url = await storage.ref(path).getDownloadURL();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadArtifacts(rep) {
    if (state.preview) return previewArtifacts();
    if (state.shareToken) {
      const getArtifacts = cloudFunctions.httpsCallable("getAthleteSharedRepArtifacts");
      const response = await getArtifacts({
        token: state.shareToken,
        drill: config.key,
        repId: rep.id
      });
      const urls = response?.data?.artifactUrls || {};
      const pairs = await Promise.all(config.artifacts.map(async fileName => {
        const url = urls[fileName];
        if (!url) return [fileName, null];
        try {
          const artifactResponse = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
          if (!artifactResponse.ok) throw new Error(`HTTP ${artifactResponse.status}`);
          return [fileName, await artifactResponse.json()];
        } catch (_) {
          return [fileName, null];
        }
      }));
      return { folder: "shared", ...Object.fromEntries(pairs) };
    }
    const folders = folderCandidates(rep);
    for (const folder of folders) {
      try {
        const pairs = await Promise.all(config.artifacts.map(async fileName => {
          try { return [fileName, await fetchStorageJson(`${folder}/${fileName}`)]; }
          catch (_) { return [fileName, null]; }
        }));
        const artifacts = Object.fromEntries(pairs);
        if (artifacts["pose.json"] || artifacts["metadata.json"]) return { folder, ...artifacts };
      } catch (_) { /* Try the next compatible folder. */ }
    }
    return { folder: folders[0] || "" };
  }

  async function selectRep(repId) {
    const rep = state.reps.find(item => item.id === repId);
    if (!rep) return;
    stopPlayback();
    state.currentRep = rep;
    state.currentFrame = 0;
    state.artifacts = {};
    state.frames = [];

    document.querySelectorAll("[data-rep-id]").forEach(button => button.classList.toggle("active", button.dataset.repId === repId));
    const repLoading = document.getElementById("repLoading");
    const repContent = document.getElementById("repContent");
    const subtitle = document.getElementById("repSubtitle");
    if (repLoading) repLoading.classList.remove("hidden");
    if (repContent) { repContent.classList.add("hidden"); repContent.innerHTML = ""; }
    if (subtitle) subtitle.textContent = `Session ${rep.sessionNumber} · Rep ${rep.repNumber} · ${formatDate(rep.createdAtMillis)}`;

    const requestedUrl = new URL(location.href);
    if (!state.shareToken) requestedUrl.searchParams.set("player", state.player.id);
    requestedUrl.searchParams.set("session", `session${rep.sessionNumber}`);
    requestedUrl.searchParams.set("rep", `kick${rep.repNumber}`);
    history.replaceState({}, "", requestedUrl);

    state.artifacts = await loadArtifacts(rep);
    state.frames = normalizeFrames(state.artifacts["pose.json"]);
    if (rep !== state.currentRep) return;
    renderRep();
  }

  function normalizeFrames(value) {
    if (!Array.isArray(value)) return [];
    return value.map(frame => Array.isArray(frame) ? frame.map(point => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const x = asNumber(point[0]);
      const y = asNumber(point[1]);
      const visibility = asNumber(point[3]);
      if (x === null || y === null || (visibility !== null && visibility < 0.1)) return null;
      return { x, y, visibility };
    }) : []);
  }

  function previewArtifacts() {
    const totalFrames = 96;
    const pose = [];
    const centers = [];
    const feet = [];
    const heights = [];
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const progress = frame / (totalFrames - 1);
      const travel = config.key === "broadJump"
        ? 0.18 + progress * 0.62
        : (progress < 0.5 ? 0.18 + progress * 1.22 : 0.79 - (progress - 0.5) * 1.22);
      const lift = config.key === "broadJump" ? Math.sin(progress * Math.PI) * 0.18 : 0;
      const point = (x, y) => [x + travel - 0.5, y - lift, 0, 0.98];
      pose.push([
        point(0.50,0.15), point(0.48,0.14), point(0.52,0.14), point(0.46,0.15), point(0.54,0.15),
        point(0.43,0.31), point(0.57,0.31), point(0.39,0.44), point(0.61,0.44), point(0.36,0.56), point(0.64,0.56),
        point(0.46,0.55), point(0.54,0.55), point(0.44,0.73), point(0.56,0.73), point(0.43,0.92), point(0.57,0.92)
      ]);
      centers.push([travel, 0.55 - lift]);
      feet.push([travel, 0.92 - lift]);
      heights.push(Math.max(0, lift * 1.55));
    }
    if (config.key === "broadJump") {
      return {
        folder: "preview",
        "pose.json": pose,
        "metadata.json": { broadJumpDistance: 1.82, jumpHeight: 0.29, ground_loc_y: 0.94, footSide: "right", resultsValid: true, framesPerSecond: 120 },
        "foot_piecewise_fit.json": { takeoffFrameIndex: 18, landingFrameIndex: 80, startFootXNorm: 0.27, endFootXNorm: 0.72, footSide: "right" },
        "key_frames.json": [18, 80],
        "foot_centers.json": feet,
        "com_midpoints.json": centers,
        "com_height.json": heights
      };
    }
    return {
      folder: "preview",
      "pose.json": pose,
      "metadata.json": {
        totalTime: 4.42, totalDistance: 9.8, outboundDistance: 4.9, returnDistance: 4.9,
        phase1Time: 1.72, phase2Time: 0.91, phase3Time: 1.79, markerDistance: 4.9,
        startFrame: 4, phase1EndFrame: 42, apexFrame: 48, phase2EndFrame: 56, endFrame: 92,
        framesPerSecond: 24, failedSteps: []
      }
    };
  }

  function metadata() { return state.artifacts["metadata.json"] || {}; }
  function mergedMetric(field) {
    const artifactValue = asNumber(metadata()[field]);
    return artifactValue !== null ? artifactValue : asNumber(state.currentRep?.[field]);
  }

  function renderRep() {
    const loading = document.getElementById("repLoading");
    const content = document.getElementById("repContent");
    if (!content) return;
    if (loading) loading.classList.add("hidden");
    content.classList.remove("hidden");

    content.innerHTML = `
      <div class="viewer-layout">
        <div>
          <div class="viewer-stage" id="viewerStage">
            <canvas id="poseCanvas" aria-label="Pose playback for the selected rep"></canvas>
            <span id="frameChip" class="frame-chip">Frame 0</span>
            <span id="phaseChip" class="phase-chip hidden"></span>
          </div>
          <div class="playback-controls">
            <button id="playButton" class="control-button" type="button" aria-label="Play"><span class="material-symbols-outlined">play_arrow</span></button>
            <button id="previousButton" class="control-button" type="button" aria-label="Previous frame"><span class="material-symbols-outlined">skip_previous</span></button>
            <button id="nextButton" class="control-button" type="button" aria-label="Next frame"><span class="material-symbols-outlined">skip_next</span></button>
            <input id="frameSlider" class="frame-slider" type="range" min="0" max="${Math.max(0, state.frames.length - 1)}" value="0" aria-label="Frame">
            <button id="speedButton" class="control-button" type="button" aria-label="Playback speed" style="width:auto;padding:0 .65rem">0.5×</button>
            <span id="frameCount" class="frame-count">0 / ${Math.max(0, state.frames.length - 1)}</span>
          </div>
          <div id="markerRow" class="marker-row">${renderMarkers()}</div>
          ${state.frames.length ? "" : `<div class="coach-note"><strong>Pose playback unavailable</strong><p>The summary metrics are available, but this rep's pose.json artifact could not be loaded. Raw video uploads are optional for locally processed drills.</p></div>`}
        </div>
        <aside>
          <div id="metricGrid" class="metric-grid"></div>
          ${renderCoachNote()}
        </aside>
      </div>
    `;

    const resultsValid = metadata().resultsValid;
    const failedSteps = Array.isArray(metadata().failedSteps) ? metadata().failedSteps : [];
    const banner = document.getElementById("validationBanner");
    const message = document.getElementById("validationMessage");
    const hasWarning = resultsValid === false || failedSteps.length > 0;
    if (banner) banner.classList.toggle("hidden", !hasWarning);
    if (message && hasWarning) {
      message.textContent = config.key === "broadJump"
        ? "Foot tracking flagged this rep. The displayed distance may be unreliable."
        : `Processing flagged this rep${failedSteps.length ? `: ${failedSteps.join(", ")}` : ". Some metrics may be missing."}`;
    }

    bindRepControls();
    renderMetrics();
    drawFrame();
    const stage = document.getElementById("viewerStage");
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (stage && window.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(drawFrame);
      state.resizeObserver.observe(stage);
    }
  }

  function renderMarkers() {
    if (config.key === "broadJump") {
      const fit = state.artifacts["foot_piecewise_fit.json"] || {};
      const keyFrames = state.artifacts["key_frames.json"] || [];
      const takeoff = asInteger(fit.takeoffFrameIndex) ?? asInteger(keyFrames[0]) ?? asInteger(state.currentRep.takeoffFrame);
      const landing = asInteger(fit.landingFrameIndex) ?? asInteger(keyFrames[1]) ?? asInteger(state.currentRep.landingFrame);
      return markerButton("Takeoff", "flight_takeoff", takeoff) + markerButton("Landing", "flight_land", landing);
    }
    const start = asInteger(metadata().startFrame) ?? asInteger(state.currentRep.startFrame);
    const turn = asInteger(metadata().apexFrame) ?? asInteger(state.currentRep.apexFrame);
    const finish = asInteger(metadata().endFrame) ?? asInteger(state.currentRep.endFrame);
    return markerButton("Start", "flag", start) + markerButton("Turn", "switch_access_shortcut", turn) + markerButton("Finish", "sports_score", finish);
  }

  function markerButton(label, icon, frame) {
    const disabled = frame === null || frame === undefined;
    return `<button class="marker-button" type="button" data-frame="${disabled ? "" : frame}" ${disabled ? "disabled" : ""}><span class="material-symbols-outlined">${icon}</span> ${escapeHtml(label)}</button>`;
  }

  function renderCoachNote() {
    if (config.key === "broadJump") {
      return `<div class="coach-note"><strong>What to review</strong><p>Use Takeoff and Landing to inspect launch angle, arm swing, full hip extension, and whether the athlete can hold the landing without falling backward.</p></div>`;
    }
    return `<div class="coach-note"><strong>What to review</strong><p>Use Start, Turn, and Finish to inspect braking steps, hip height at the plant, outside-foot position, and the first two acceleration steps out of the turn.</p></div>`;
  }

  function metricCard(icon, label, value, dynamicId = "") {
    return `<article class="metric-card"><span class="material-symbols-outlined">${icon}</span><span ${dynamicId ? `id="${dynamicId}"` : ""} class="metric-value">${escapeHtml(value)}</span><span class="metric-label">${escapeHtml(label)}</span></article>`;
  }

  function renderMetrics() {
    const grid = document.getElementById("metricGrid");
    if (!grid) return;
    if (config.key === "broadJump") {
      const distance = mergedMetric("broadJumpDistance");
      const height = mergedMetric("jumpHeight");
      const fit = state.artifacts["foot_piecewise_fit.json"] || {};
      const keyFrames = state.artifacts["key_frames.json"] || [];
      const takeoff = asInteger(fit.takeoffFrameIndex) ?? asInteger(keyFrames[0]) ?? asInteger(state.currentRep.takeoffFrame);
      const landing = asInteger(fit.landingFrameIndex) ?? asInteger(keyFrames[1]) ?? asInteger(state.currentRep.landingFrame);
      const fps = asNumber(metadata().framesPerSecond) || 120;
      const flight = takeoff !== null && landing !== null && landing > takeoff ? (landing - takeoff) / fps : null;
      const foot = metadata().footSide || fit.footSide || "—";
      grid.innerHTML =
        metricCard("straighten", "Distance", distance === null ? "—" : `${metersToFeet(distance).toFixed(1)} ft`) +
        metricCard("height", "Peak height", height === null ? "—" : `${metersToInches(height).toFixed(1)} in`) +
        metricCard("timer", "Flight time", flight === null ? "—" : `${flight.toFixed(2)} s`) +
        metricCard("accessibility_new", "This frame", "—", "currentHeightValue") +
        metricCard("steps", "Tracked foot", String(foot).replace(/^./, value => value.toUpperCase()));
      updateDynamicMetrics();
      return;
    }

    const total = mergedMetric("totalTime");
    const phase1 = mergedMetric("phase1Time");
    const phase2 = mergedMetric("phase2Time");
    const phase3 = mergedMetric("phase3Time");
    const distance = mergedMetric("totalDistance");
    const marker = mergedMetric("markerDistance");
    grid.innerHTML =
      metricCard("timer", "Total time", total === null ? "—" : `${total.toFixed(2)} s`) +
      metricCard("arrow_forward", "Outbound", phase1 === null ? "—" : `${phase1.toFixed(2)} s`) +
      metricCard("switch_access_shortcut", "Turn", phase2 === null ? "—" : `${phase2.toFixed(2)} s`) +
      metricCard("arrow_back", "Return", phase3 === null ? "—" : `${phase3.toFixed(2)} s`) +
      metricCard("straighten", "Total distance", distance === null ? "—" : `${metersToFeet(distance).toFixed(1)} ft`) +
      metricCard("swap_horiz", "Gate width", marker === null ? "—" : `${metersToFeet(marker).toFixed(1)} ft`);
  }

  function bindRepControls() {
    document.getElementById("playButton")?.addEventListener("click", togglePlayback);
    document.getElementById("previousButton")?.addEventListener("click", () => setFrame(state.currentFrame - 1));
    document.getElementById("nextButton")?.addEventListener("click", () => setFrame(state.currentFrame + 1));
    document.getElementById("frameSlider")?.addEventListener("input", event => setFrame(Number(event.target.value)));
    document.getElementById("speedButton")?.addEventListener("click", cycleSpeed);
    document.querySelectorAll("[data-frame]").forEach(button => button.addEventListener("click", () => setFrame(Number(button.dataset.frame))));
  }

  function cycleSpeed() {
    const speeds = [0.25, 0.5, 1];
    state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
    const button = document.getElementById("speedButton");
    if (button) button.textContent = `${state.speed}×`;
  }

  function togglePlayback() {
    if (!state.frames.length) return;
    state.playing = !state.playing;
    const icon = document.querySelector("#playButton .material-symbols-outlined");
    const button = document.getElementById("playButton");
    if (icon) icon.textContent = state.playing ? "pause" : "play_arrow";
    if (button) button.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    if (state.playing) {
      if (state.currentFrame >= state.frames.length - 1) setFrame(0);
      state.lastTick = performance.now();
      state.frameAccumulator = 0;
      state.animationId = requestAnimationFrame(playbackTick);
    } else {
      cancelAnimationFrame(state.animationId);
    }
  }

  function playbackTick(now) {
    if (!state.playing) return;
    const fps = asNumber(metadata().framesPerSecond) || 120;
    const elapsed = Math.min(100, now - state.lastTick) / 1000;
    state.lastTick = now;
    state.frameAccumulator += elapsed * fps * state.speed;
    const advance = Math.floor(state.frameAccumulator);
    if (advance > 0) {
      state.frameAccumulator -= advance;
      if (state.currentFrame + advance >= state.frames.length) {
        setFrame(state.frames.length - 1);
        stopPlayback();
        return;
      }
      setFrame(state.currentFrame + advance);
    }
    state.animationId = requestAnimationFrame(playbackTick);
  }

  function stopPlayback() {
    state.playing = false;
    cancelAnimationFrame(state.animationId);
    const icon = document.querySelector("#playButton .material-symbols-outlined");
    const button = document.getElementById("playButton");
    if (icon) icon.textContent = "play_arrow";
    if (button) button.setAttribute("aria-label", "Play");
  }

  function setFrame(frame) {
    const max = Math.max(0, state.frames.length - 1);
    state.currentFrame = Math.max(0, Math.min(max, Number.isFinite(frame) ? Math.round(frame) : 0));
    const slider = document.getElementById("frameSlider");
    const frameChip = document.getElementById("frameChip");
    const frameCount = document.getElementById("frameCount");
    if (slider) slider.value = state.currentFrame;
    if (frameChip) frameChip.textContent = `Frame ${state.currentFrame}`;
    if (frameCount) frameCount.textContent = `${state.currentFrame} / ${max}`;
    updateDynamicMetrics();
    drawFrame();
  }

  function updateDynamicMetrics() {
    if (config.key !== "broadJump") return;
    const heightSeries = state.artifacts["com_height.json"];
    const currentHeight = Array.isArray(heightSeries) ? asNumber(heightSeries[state.currentFrame]) : null;
    const value = document.getElementById("currentHeightValue");
    if (value) value.textContent = currentHeight === null ? "—" : `${metersToInches(currentHeight).toFixed(1)} in`;
  }

  function validPoint(frame, index) {
    const point = frame?.[index];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  function canvasSetup() {
    const canvas = document.getElementById("poseCanvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { canvas, context, width: rect.width, height: rect.height };
  }

  function mapped(point, width, height) { return { x: point.x * width, y: point.y * height }; }

  function drawFrame() {
    const setup = canvasSetup();
    if (!setup) return;
    const { context, width, height } = setup;
    context.clearRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#10271f");
    gradient.addColorStop(1, "#07130f");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const frame = state.frames[state.currentFrame] || [];
    if (!frame.length) {
      context.fillStyle = "rgba(255,255,255,.65)";
      context.font = "600 14px Inter, sans-serif";
      context.textAlign = "center";
      context.fillText(state.frames.length ? "Pose not detected in this frame" : "Pose artifact unavailable", width / 2, height / 2);
      updatePhaseChip();
      return;
    }

    if (config.key === "broadJump") drawBroadJumpOverlay(context, width, height);
    else drawShuttleOverlay(context, width, height);

    const edges = frame.length >= 30 ? skeleton33 : skeleton17;
    context.strokeStyle = "rgba(247,251,249,.9)";
    context.lineWidth = 2;
    edges.forEach(([a, b]) => {
      const first = validPoint(frame, a);
      const second = validPoint(frame, b);
      if (!first || !second) return;
      const p1 = mapped(first, width, height);
      const p2 = mapped(second, width, height);
      context.beginPath(); context.moveTo(p1.x, p1.y); context.lineTo(p2.x, p2.y); context.stroke();
    });
    frame.forEach(point => {
      if (!point) return;
      const p = mapped(point, width, height);
      context.beginPath(); context.arc(p.x, p.y, 3, 0, Math.PI * 2);
      context.fillStyle = "#63b487"; context.fill();
      context.strokeStyle = "rgba(255,255,255,.8)"; context.lineWidth = 1; context.stroke();
    });
    updatePhaseChip();
  }

  function parsePoint(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    const x = asNumber(value[0]);
    const y = asNumber(value[1]);
    return x === null || y === null ? null : { x, y };
  }

  function drawBroadJumpOverlay(context, width, height) {
    const meta = metadata();
    const fit = state.artifacts["foot_piecewise_fit.json"] || {};
    const ground = asNumber(meta.ground_loc_y);
    const takeoffX = asNumber(fit.startFootXNorm);
    const landingX = asNumber(fit.endFootXNorm);
    if (ground !== null) {
      context.strokeStyle = "rgba(0,0,0,.75)"; context.lineWidth = 2;
      context.beginPath(); context.moveTo(0, ground * height); context.lineTo(width, ground * height); context.stroke();
    }
    [[takeoffX, "#71d39b"], [landingX, "#ff7d7d"]].forEach(([x, color]) => {
      if (x === null) return;
      context.save(); context.setLineDash([7, 5]); context.strokeStyle = color; context.lineWidth = 2;
      context.beginPath(); context.moveTo(x * width, 0); context.lineTo(x * width, height); context.stroke(); context.restore();
    });
    if (takeoffX !== null && landingX !== null) {
      const distance = mergedMetric("broadJumpDistance");
      context.fillStyle = "rgba(0,0,0,.68)";
      const centerX = ((takeoffX + landingX) / 2) * width;
      const labelY = Math.max(22, (ground ?? 0.9) * height - 18);
      context.fillRect(centerX - 34, labelY - 15, 68, 24);
      context.fillStyle = "#fff"; context.font = "700 12px Inter"; context.textAlign = "center";
      context.fillText(distance === null ? "—" : `${metersToFeet(distance).toFixed(1)} ft`, centerX, labelY + 1);
    }

    const comSeries = Array.isArray(state.artifacts["com_midpoints.json"]) ? state.artifacts["com_midpoints.json"] : [];
    const low = Math.max(0, state.currentFrame - 40);
    context.strokeStyle = "#66d6e8"; context.lineWidth = 2; context.beginPath();
    let started = false;
    for (let index = low; index <= state.currentFrame && index < comSeries.length; index += 1) {
      const point = parsePoint(comSeries[index]);
      if (!point) continue;
      const p = mapped(point, width, height);
      if (started) context.lineTo(p.x, p.y); else { context.moveTo(p.x, p.y); started = true; }
    }
    if (started) context.stroke();

    const currentCom = parsePoint(comSeries[state.currentFrame]);
    const footSeries = Array.isArray(state.artifacts["foot_centers.json"]) ? state.artifacts["foot_centers.json"] : [];
    const currentFoot = parsePoint(footSeries[state.currentFrame]);
    [[currentCom, "#66d6e8", 4], [currentFoot, "#ffad5c", 3.5]].forEach(([point, color, radius]) => {
      if (!point) return;
      const p = mapped(point, width, height);
      context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fillStyle = color; context.fill();
    });
  }

  function hipCenter(frame) {
    if (!frame?.length) return null;
    const indices = frame.length >= 30 ? [23, 24] : [11, 12];
    const left = validPoint(frame, indices[0]);
    const right = validPoint(frame, indices[1]);
    return left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : null;
  }

  function shuttlePhase(frameIndex) {
    const start = asInteger(metadata().startFrame) ?? asInteger(state.currentRep.startFrame);
    const end = asInteger(metadata().endFrame) ?? asInteger(state.currentRep.endFrame);
    const phase1End = asInteger(metadata().phase1EndFrame) ?? asInteger(state.currentRep.phase1EndFrame);
    const phase2End = asInteger(metadata().phase2EndFrame) ?? asInteger(state.currentRep.phase2EndFrame);
    if ([start, end, phase1End, phase2End].some(value => value === null) || frameIndex < start || frameIndex > end) return null;
    if (frameIndex <= phase1End) return { key: "outbound", title: "Outbound", color: "#66c2ff" };
    if (frameIndex <= phase2End) return { key: "turn", title: "Turn", color: "#ffc969" };
    return { key: "inbound", title: "Return", color: "#71d39b" };
  }

  function drawShuttleOverlay(context, width, height) {
    const start = asInteger(metadata().startFrame) ?? 0;
    ["outbound", "turn", "inbound"].forEach(phaseKey => {
      context.beginPath();
      let started = false;
      let phaseColor = "#fff";
      for (let index = start; index <= state.currentFrame && index < state.frames.length; index += 1) {
        const phase = shuttlePhase(index);
        const center = hipCenter(state.frames[index]);
        if (!phase || phase.key !== phaseKey || !center) continue;
        phaseColor = phase.color;
        const p = mapped(center, width, height);
        if (started) context.lineTo(p.x, p.y); else { context.moveTo(p.x, p.y); started = true; }
      }
      if (started) { context.strokeStyle = phaseColor; context.lineWidth = 2.5; context.stroke(); }
    });
    const center = hipCenter(state.frames[state.currentFrame]);
    if (center) {
      const phase = shuttlePhase(state.currentFrame);
      const p = mapped(center, width, height);
      context.beginPath(); context.arc(p.x, p.y, 4.5, 0, Math.PI * 2); context.fillStyle = phase?.color || "#fff"; context.fill();
      context.strokeStyle = "#fff"; context.lineWidth = 1; context.stroke();
    }
  }

  function updatePhaseChip() {
    const chip = document.getElementById("phaseChip");
    if (!chip) return;
    if (config.key === "broadJump") {
      const heights = state.artifacts["com_height.json"];
      const value = Array.isArray(heights) ? asNumber(heights[state.currentFrame]) : null;
      chip.classList.toggle("hidden", value === null);
      if (value !== null) { chip.style.color = "#fff"; chip.textContent = `COM ${metersToInches(value).toFixed(1)} in`; }
      return;
    }
    const phase = shuttlePhase(state.currentFrame);
    const start = asInteger(metadata().startFrame) ?? asInteger(state.currentRep.startFrame);
    const fps = asNumber(metadata().framesPerSecond) || 120;
    chip.classList.toggle("hidden", !phase);
    if (phase) {
      const elapsed = start === null ? 0 : Math.max(0, state.currentFrame - start) / fps;
      chip.style.color = phase.color;
      chip.textContent = `${phase.title} · ${elapsed.toFixed(2)} s`;
    }
  }

  async function start(user) {
    try {
      showLoading("Resolving athlete profile…");
      state.viewer = await resolveViewer(user);
      state.player = await resolveAuthorizedPlayer(state.viewer);
      showLoading(`Loading ${config.title.toLowerCase()} results…`);
      state.reps = await loadReps(state.player.id);
      renderShell();
    } catch (error) {
      console.error(`[${config.key}]`, error);
      showError("Unable to open these results", error?.message || "The athlete data could not be loaded.");
    }
  }

  async function startShared(token) {
    try {
      state.shareToken = token;
      showLoading(`Opening shared ${config.title.toLowerCase()} resultsâ€¦`);
      const getShare = cloudFunctions.httpsCallable("getAthleteResultsShare");
      const response = await getShare({ token, drill: config.key });
      const payload = response?.data || {};
      state.viewer = { role: "shared" };
      state.player = { id: null, data: payload.athlete || {} };
      state.shareExpiresAtMillis = asNumber(payload.expiresAtMillis);
      state.reps = (Array.isArray(payload.reps) ? payload.reps : []).map(rep => ({
        ...rep,
        primary: asNumber(rep[config.primaryField]),
        createdAtMillis: asNumber(rep.createdAtMillis) || 0,
        sessionNumber: asInteger(rep.sessionNumber) || 1,
        repNumber: asInteger(rep.repNumber) || asInteger(rep.absoluteRepNumber) || 1,
        absoluteRepNumber: asInteger(rep.absoluteRepNumber)
      }));
      renderShell();
    } catch (error) {
      console.error(`[${config.key}] shared link failed`, error);
      const detail = error?.message && error.message !== "internal"
        ? error.message
        : "Ask the coach to send a new athlete results link.";
      showError(
        "This results link is unavailable",
        detail
      );
    }
  }

  function startPreview() {
    state.preview = true;
    state.viewer = { role: "coach", uid: "preview", docId: "preview-coach", data: { members: ["preview-player"] } };
    state.player = { id: "preview-player", data: { firstName: "Jordan", lastName: "Athlete" } };
    const primaryValues = config.key === "broadJump" ? [1.82, 1.68, 1.74, 1.59] : [4.42, 4.58, 4.51, 4.77];
    state.reps = primaryValues.map((primary, index) => ({
      id: `preview-${index + 1}`,
      [config.primaryField]: primary,
      primary,
      sessionNumber: index < 2 ? 2 : 1,
      repNumber: index % 2 + 1,
      absoluteRepNumber: primaryValues.length - index,
      createdAtMillis: Date.now() - index * 86400000 * 8,
      ...(config.key === "broadJump" ? { jumpHeight: 0.29, takeoffFrame: 18, landingFrame: 80 } : { totalDistance: 9.8, phase1Time: 1.72, phase2Time: 0.91, phase3Time: 1.79, markerDistance: 4.9 })
    }));
    renderShell();
  }

  if (!config) {
    showError("Unsupported test", "This results page is missing its drill configuration.");
    return;
  }

  showLoading();
  if (isLocal && params.get("preview") === "1") {
    startPreview();
    return;
  }
  const sharedToken = params.get("share");
  if (sharedToken) {
    startShared(sharedToken);
    return;
  }
  auth.onAuthStateChanged(user => {
    if (!user) {
      if (isLocal) showError("Sign-in required", "Local preview is ready, but athlete data requires a signed-in Firebase account.");
      else redirectToLogin();
      return;
    }
    start(user);
  });
})();
