(function () {
  "use strict";

  const VIEW_LABELS = {
    home: "Athlete Home",
    profile: "Body Profile",
    aiCoach: "AI Coach",
    drills: "Drill Results",
    training: "Training",
    leaderboards: "Leaderboards",
  };
  const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23],
    [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31],
    [24, 26], [26, 28], [28, 30], [30, 32],
  ];
  const LIMBS = [
    { name: "Trunk", edge: [11, 23], length: "trunk_length", weight: "trunk" },
    { name: "Left upper arm", edge: [11, 13], length: "humerus_length", weight: "upper_arm_left" },
    { name: "Right upper arm", edge: [12, 14], length: "humerus_length", weight: "upper_arm_right" },
    { name: "Left forearm", edge: [13, 15], length: "forearm_length", weight: "forearm_left" },
    { name: "Right forearm", edge: [14, 16], length: "forearm_length", weight: "forearm_right" },
    { name: "Left thigh", edge: [23, 25], length: "femur_length", weight: "thigh_left" },
    { name: "Right thigh", edge: [24, 26], length: "femur_length", weight: "thigh_right" },
    { name: "Left shank", edge: [25, 27], length: "tibia_length", weight: "shank_left" },
    { name: "Right shank", edge: [26, 28], length: "tibia_length", weight: "shank_right" },
  ];
  const CHAT_SUGGESTIONS = [
    "How am I progressing over time?",
    "What are my best reps?",
    "How do I compare to the pro standard?",
    "What should I work on next?",
  ];
  const LEADERBOARD_CATEGORIES = [
    { key: "changeOfDirection", label: "Agility", icon: "switch_access_shortcut", lower: true, unit: "s", fields: ["totalTime"] },
    { key: "sprint", label: "Sprint", icon: "sprint", lower: false, unit: "mph", fields: ["max_velocity", "maxVelocity"], convert: value => value * 2.23694 },
    { key: "jump", label: "Jump", icon: "jump_to_element", lower: false, unit: "in", fields: ["jumpHeight"], convert: value => value * 39.3701 },
    { key: "shooting", label: "Shooting", icon: "sports_soccer", lower: false, unit: "mph", fields: ["velocity"], convert: value => value * 2.23694 },
    { key: "dribbling", label: "Dribbling", icon: "sports_soccer", lower: true, unit: "s", fields: ["totalTime"] },
  ];

  let renderVersion = 0;
  let cleanupTasks = [];
  let activeChatController = null;

  function clean() {
    renderVersion += 1;
    cleanupTasks.splice(0).forEach(task => {
      try { task(); } catch (_) {}
    });
    if (activeChatController) activeChatController.abort();
    activeChatController = null;
  }

  function pageHeader(eyebrow, title, description, icon) {
    return `<header class="mobile-page-hero"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div><span class="hero-icon"><span class="material-symbols-outlined">${icon}</span></span></header>`;
  }

  function loading(message) {
    return `<div class="portal-loading"><span class="spinner"></span><p>${message}</p></div>`;
  }

  function empty(icon, title, message) {
    return `<div class="mobile-empty"><span class="material-symbols-outlined">${icon}</span><h3>${title}</h3><p>${message}</p></div>`;
  }

  function timestamp(value) {
    const date = value?.toDate?.() || (value instanceof Date ? value : value ? new Date(value) : null);
    return date && !Number.isNaN(date.valueOf()) ? date : null;
  }

  function dateText(value) {
    const date = timestamp(value);
    return date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date) : "Recently";
  }

  function number(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function initials(name) {
    return String(name || "A").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  }

  function requireAccount(context, title, copy) {
    if (context.state.access !== "shared") return false;
    context.app.innerHTML = `<section class="mobile-page">${pageHeader("Private athlete feature", title, copy, "lock")}<section class="portal-card">${empty("shield_lock", "Sign-in protected", "For athlete privacy, this page is only available to the athlete or their connected coach. The shared results link continues to include Athlete Home and Drill Results.")}</section></section>`;
    return true;
  }

  async function storageJson(reference) {
    const url = await reference.getDownloadURL();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${reference.name}`);
    return response.json();
  }

  function normalizePose(raw) {
    const source = Array.isArray(raw?.[0]) && typeof raw[0][0] === "number" ? raw : (Array.isArray(raw?.landmarks) ? raw.landmarks : raw);
    return (Array.isArray(source) ? source : []).map((point, index) => ({
      id: index,
      x: number(Array.isArray(point) ? point[0] : point?.x),
      y: number(Array.isArray(point) ? point[1] : point?.y),
      z: number(Array.isArray(point) ? point[2] : point?.z),
      visibility: number(Array.isArray(point) ? point[3] : point?.visibility) ?? 1,
    }));
  }

  function renderBodyProfile(context) {
    if (requireAccount(context, "Body Profile", "Body-scan measurements are private health-adjacent data.")) return;
    const { app, state, escape, fullName } = context;
    app.innerHTML = `<section class="mobile-page body-profile-page">
      ${pageHeader("Mobile profile", "Body Profile", "Your latest 33-point body scan and physical measurements.", "accessibility_new")}
      <section class="body-profile-grid">
        <article class="portal-card body-scan-card">
          <div class="card-heading"><div><h2>${escape(fullName(state.athlete))}</h2><p id="bodyScanStatus">Finding the latest scan…</p></div><span class="scan-count" id="bodyScanCount">—</span></div>
          <div class="body-canvas-wrap" id="bodyCanvasWrap"><canvas id="bodyPoseCanvas" aria-label="Interactive body scan"></canvas><p>Loading body scan…</p></div>
          <p class="body-hint"><span class="material-symbols-outlined">touch_app</span>Tap a body segment to inspect its measurement.</p>
        </article>
        <div class="body-profile-details">
          <section class="portal-card"><div class="card-heading"><div><h2>Physical Profile</h2><p>From the athlete record</p></div></div><div class="physical-stat-row"><article><small>Height</small><strong id="bodyHeight">—</strong></article><article><small>Weight</small><strong id="bodyWeight">—</strong></article></div></section>
          <section class="portal-card"><div class="card-heading"><div><h2>Measurements</h2><p id="measurementPrompt">Select a body segment</p></div><button class="text-button" id="clearLimbs" type="button">Clear</button></div><div class="limb-measurements" id="limbMeasurements"></div></section>
          <section class="portal-card scan-note"><span class="material-symbols-outlined">photo_camera</span><div><h3>Capture on mobile</h3><p>The body scan uses the iPhone capture flow for camera calibration and processing. New scans taken in the app appear here automatically.</p></div></section>
        </div>
      </section>
    </section>`;

    const height = number(state.athlete?.height);
    const weightKg = number(state.athlete?.weight);
    document.getElementById("bodyHeight").textContent = height ? `${Math.floor(height / 30.48)}′ ${Math.round((height / 2.54) % 12)}″` : "—";
    document.getElementById("bodyWeight").textContent = weightKg ? `${Math.round(weightKg * 2.20462)} lbs` : "—";

    if (state.access === "preview") {
      const demo = Array.from({ length: 33 }, (_, id) => ({ id, x: .5, y: .5, visibility: 1 }));
      Object.assign(demo[11], { x: .38, y: .25 }); Object.assign(demo[12], { x: .62, y: .25 });
      Object.assign(demo[13], { x: .28, y: .42 }); Object.assign(demo[14], { x: .72, y: .42 });
      Object.assign(demo[15], { x: .22, y: .6 }); Object.assign(demo[16], { x: .78, y: .6 });
      Object.assign(demo[23], { x: .43, y: .52 }); Object.assign(demo[24], { x: .57, y: .52 });
      Object.assign(demo[25], { x: .4, y: .72 }); Object.assign(demo[26], { x: .6, y: .72 });
      Object.assign(demo[27], { x: .38, y: .92 }); Object.assign(demo[28], { x: .62, y: .92 });
      Object.assign(demo[29], { x: .36, y: .94 }); Object.assign(demo[30], { x: .64, y: .94 });
      Object.assign(demo[31], { x: .4, y: .96 }); Object.assign(demo[32], { x: .6, y: .96 });
      document.getElementById("bodyScanStatus").textContent = "Latest scan · preview";
      document.getElementById("bodyScanCount").textContent = "1 scan";
      setupBodyCanvas(demo, null, { trunk_length: .58, humerus_length: .33, forearm_length: .27, femur_length: .47, tibia_length: .43 }, { trunk: 31.2, upper_arm_left: 2.1, upper_arm_right: 2.1, forearm_left: 1.2, forearm_right: 1.2, thigh_left: 7.4, thigh_right: 7.4, shank_left: 3.4, shank_right: 3.4 });
      return;
    }

    const version = renderVersion;
    (async () => {
      const root = context.storage.ref(`${state.playerId}/bodyScans`);
      const listing = await root.listAll();
      if (version !== renderVersion) return;
      const scans = listing.prefixes.map(ref => ({ ref, number: number(ref.name.replace(/^kick/i, "")) ?? 0 })).sort((a, b) => b.number - a.number);
      document.getElementById("bodyScanCount").textContent = `${scans.length}/2 scans`;
      if (!scans.length) {
        document.getElementById("bodyScanStatus").textContent = "No body scans yet";
        document.getElementById("bodyCanvasWrap").innerHTML = empty("accessibility_new", "No scan available", "Complete a body scan in the mobile app to build this profile.");
        return;
      }
      const latest = scans[0].ref;
      document.getElementById("bodyScanStatus").textContent = `Latest scan · Scan ${scans[0].number}`;
      const [pose, lengths, weights, maskUrl] = await Promise.all([
        storageJson(latest.child("pose.json")),
        storageJson(latest.child("limb_length_library.json")).catch(() => ({})),
        storageJson(latest.child("limb_weights_library.json")).catch(() => ({})),
        latest.child("human_mask.png").getDownloadURL().catch(() => null),
      ]);
      if (version !== renderVersion) return;
      setupBodyCanvas(normalizePose(pose), maskUrl, lengths || {}, weights || {});
    })().catch(error => {
      console.error("[body profile]", error);
      if (version !== renderVersion) return;
      document.getElementById("bodyScanStatus").textContent = "Body scan unavailable";
      document.getElementById("bodyCanvasWrap").innerHTML = empty("cloud_off", "Could not load the scan", "The athlete record is available, but the latest body-scan files could not be opened.");
    });
  }

  function setupBodyCanvas(points, maskUrl, lengths, weights) {
    const canvas = document.getElementById("bodyPoseCanvas");
    const wrap = document.getElementById("bodyCanvasWrap");
    if (!canvas || !points.length) return;
    wrap.querySelector("p")?.remove();
    const selected = new Set();
    const image = new Image();
    image.crossOrigin = "anonymous";
    if (maskUrl) image.src = maskUrl;
    const ctx = canvas.getContext("2d");
    const mapPoint = point => ({ x: point.x * canvas.clientWidth, y: point.y * canvas.clientHeight });
    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = "100%"; canvas.style.height = "100%";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (image.complete && image.naturalWidth) {
        ctx.globalAlpha = .28;
        ctx.drawImage(image, 0, 0, rect.width, rect.height);
        ctx.globalAlpha = 1;
      }
      POSE_CONNECTIONS.forEach(edge => {
        const a = points[edge[0]], b = points[edge[1]];
        if (!a || !b || a.x === null || b.x === null) return;
        const limb = LIMBS.find(item => item.edge[0] === edge[0] && item.edge[1] === edge[1]);
        const active = limb && selected.has(limb.name);
        const p = mapPoint(a), q = mapPoint(b);
        ctx.strokeStyle = active ? "#ffffff" : "#b7f34a";
        ctx.lineWidth = active ? 8 : 4;
        ctx.shadowColor = active ? "rgba(255,255,255,.75)" : "rgba(183,243,74,.45)";
        ctx.shadowBlur = active ? 14 : 7;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      });
      ctx.shadowBlur = 0; ctx.fillStyle = "#f7fbf9";
      points.forEach(point => {
        if (point.x === null || point.y === null || point.visibility < .2) return;
        const p = mapPoint(point); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      });
    };
    const renderMeasurements = () => {
      const root = document.getElementById("limbMeasurements");
      const rows = [...selected].map(name => LIMBS.find(item => item.name === name)).filter(Boolean);
      document.getElementById("measurementPrompt").textContent = rows.length ? `${rows.length} selected` : "Select a body segment";
      root.innerHTML = rows.length ? rows.map(limb => {
        const inches = number(lengths[limb.length]);
        const pounds = number(weights[limb.weight]);
        return `<article><strong>${limb.name}</strong><span>${inches === null ? "—" : `${(inches * 39.3701).toFixed(1)} in`}</span><span>${pounds === null ? "—" : `${(pounds * 2.20462).toFixed(1)} lbs`}</span></article>`;
      }).join("") : `<p class="measurement-empty">Tap a highlighted limb on the scan.</p>`;
      draw();
    };
    canvas.addEventListener("click", event => {
      const rect = canvas.getBoundingClientRect();
      const click = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      let nearest = null, nearestDistance = 34;
      LIMBS.forEach(limb => {
        const a = points[limb.edge[0]], b = points[limb.edge[1]];
        if (!a || !b) return;
        const p = mapPoint(a), q = mapPoint(b);
        const dx = q.x - p.x, dy = q.y - p.y;
        const t = Math.max(0, Math.min(1, ((click.x - p.x) * dx + (click.y - p.y) * dy) / Math.max(1, dx * dx + dy * dy)));
        const distance = Math.hypot(click.x - (p.x + t * dx), click.y - (p.y + t * dy));
        if (distance < nearestDistance) { nearest = limb; nearestDistance = distance; }
      });
      if (!nearest) return;
      if (selected.has(nearest.name)) selected.delete(nearest.name); else selected.add(nearest.name);
      renderMeasurements();
    });
    document.getElementById("clearLimbs").addEventListener("click", () => { selected.clear(); renderMeasurements(); });
    const observer = new ResizeObserver(draw); observer.observe(wrap); cleanupTasks.push(() => observer.disconnect());
    image.onload = draw;
    renderMeasurements();
  }

  function renderAiCoach(context) {
    if (requireAccount(context, "AI Coach", "AI Coach reads private rep history and personalized training context.")) return;
    const { app, escape, fullName, state } = context;
    app.innerHTML = `<section class="mobile-page ai-coach-page">
      ${pageHeader("Personal performance assistant", "AI Coach", "Knows your reps, bests, and the pro standard.", "forum")}
      <div class="ai-coach-layout">
        <aside class="portal-card conversation-panel"><button class="primary-cta" id="newConversation" type="button"><span class="material-symbols-outlined">add</span>New conversation</button><h2>History</h2><div id="conversationList">${loading("Loading history…")}</div></aside>
        <section class="portal-card chat-panel">
          <header><div><span class="chat-avatar">AI</span><div><strong>PoseTek AI Coach</strong><small>${escape(fullName(state.athlete))}</small></div></div><span class="online-dot">Ready</span></header>
          <div class="chat-messages" id="chatMessages"><div class="chat-welcome"><span class="material-symbols-outlined">auto_awesome</span><h2>What do you want to improve?</h2><p>Ask about results, progress, D1 comparisons, or the next thing to train.</p><div class="chat-suggestions">${CHAT_SUGGESTIONS.map(item => `<button type="button" data-chat-suggestion="${escape(item)}">${escape(item)}</button>`).join("")}</div></div></div>
          <div class="chat-tool-status" id="chatToolStatus" hidden></div>
          <form class="chat-composer" id="chatForm"><textarea id="chatInput" rows="1" maxlength="2000" placeholder="Ask AI Coach…" aria-label="Message AI Coach"></textarea><button type="submit" aria-label="Send message"><span class="material-symbols-outlined">arrow_upward</span></button></form>
        </section>
      </div>
    </section>`;
    if (state.access === "preview") {
      document.getElementById("conversationList").innerHTML = `<button class="conversation-row active"><strong>Improving sprint speed</strong><small>Preview conversation</small></button>`;
    } else loadConversationList(context);
    let conversationId = null;
    let unsubscribe = null;
    const detach = () => { if (unsubscribe) unsubscribe(); unsubscribe = null; };
    cleanupTasks.push(detach);

    const showMessages = messages => {
      const root = document.getElementById("chatMessages");
      root.innerHTML = messages.length ? messages.map(message => `<article class="chat-message ${message.role === "user" ? "user" : "assistant"}"><div>${escape(message.content || "").replace(/\n/g, "<br>")}</div>${message.toolCalls?.length ? `<small>Checked ${message.toolCalls.map(call => escape(call.name || call)).join(", ")}</small>` : ""}</article>`).join("") : `<div class="chat-welcome"><span class="material-symbols-outlined">auto_awesome</span><h2>Start a new conversation</h2><p>AI Coach can inspect this athlete's current rep history.</p><div class="chat-suggestions">${CHAT_SUGGESTIONS.map(item => `<button type="button" data-chat-suggestion="${escape(item)}">${escape(item)}</button>`).join("")}</div></div>`;
      root.scrollTop = root.scrollHeight;
      bindSuggestions();
    };
    const attach = id => {
      detach(); conversationId = id;
      if (!id || state.access === "preview") { showMessages([]); return; }
      unsubscribe = context.db.collection("players").doc(state.playerId).collection("aiConversations").doc(id).collection("messages").orderBy("createdAt").onSnapshot(snapshot => showMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    };
    const bindSuggestions = () => document.querySelectorAll("[data-chat-suggestion]").forEach(button => button.addEventListener("click", () => {
      document.getElementById("chatInput").value = button.dataset.chatSuggestion;
      document.getElementById("chatForm").requestSubmit();
    }));
    bindSuggestions();
    document.getElementById("newConversation").addEventListener("click", () => { attach(null); document.getElementById("chatInput").focus(); });
    document.getElementById("chatForm").addEventListener("submit", async event => {
      event.preventDefault();
      const input = document.getElementById("chatInput"), message = input.value.trim();
      if (!message || activeChatController) return;
      input.value = "";
      if (state.access === "preview") {
        showMessages([{ role: "user", content: message }, { role: "assistant", content: "In a signed-in athlete profile, AI Coach streams a response grounded in this athlete's actual reps, personal bests, and benchmark comparisons." }]);
        return;
      }
      await streamAiCoach(context, { message, conversationId, onConversation: id => { conversationId = id; }, onDone: () => { if (conversationId) { attach(conversationId); loadConversationList(context, attach); } } });
    });
    context._openConversation = attach;
  }

  async function loadConversationList(context, openConversation) {
    const root = document.getElementById("conversationList");
    if (!root) return;
    try {
      let snapshot;
      const base = context.db.collection("players").doc(context.state.playerId).collection("aiConversations").where("capability", "==", "pose_chat");
      try { snapshot = await base.orderBy("lastMessageAt", "desc").limit(20).get(); }
      catch (_) { snapshot = await base.limit(20).get(); }
      const conversations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (timestamp(b.lastMessageAt)?.valueOf() || 0) - (timestamp(a.lastMessageAt)?.valueOf() || 0));
      root.innerHTML = conversations.length ? conversations.map(item => `<button class="conversation-row" type="button" data-conversation="${context.escape(item.id)}"><strong>${context.escape(item.title || "Conversation")}</strong><small>${dateText(item.lastMessageAt)} · ${number(item.messageCount) || 0} messages</small></button>`).join("") : `<p class="conversation-empty">No conversations yet.</p>`;
      root.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => (openConversation || context._openConversation)?.(button.dataset.conversation)));
    } catch (error) {
      console.error("[AI conversations]", error);
      root.innerHTML = `<p class="conversation-empty">History is unavailable right now.</p>`;
    }
  }

  async function streamAiCoach(context, options) {
    const root = document.getElementById("chatMessages"), input = document.getElementById("chatInput"), tool = document.getElementById("chatToolStatus");
    const userMarkup = `<article class="chat-message user"><div>${context.escape(options.message)}</div></article>`;
    if (root.querySelector(".chat-welcome")) root.innerHTML = "";
    root.insertAdjacentHTML("beforeend", `${userMarkup}<article class="chat-message assistant streaming" id="streamingReply"><div><span class="typing-dots">•••</span></div></article>`);
    root.scrollTop = root.scrollHeight; input.disabled = true;
    activeChatController = new AbortController();
    try {
      const token = await context.auth.currentUser.getIdToken();
      const response = await fetch("https://us-central1-kickai-69dd0.cloudfunctions.net/aiCoachStreamProxy", {
        method: "POST", signal: activeChatController.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ schemaVersion: 1, capability: "pose_chat", playerId: context.state.playerId, message: options.message, clientVersion: "1.1+4", ...(options.conversationId ? { conversationId: options.conversationId } : {}) }),
      });
      if (!response.ok) {
        const body = await response.text();
        let detail = `AI Coach returned ${response.status}`;
        try { const parsed = JSON.parse(body); detail = parsed.error?.message || parsed.message || detail; } catch (_) {}
        throw new Error(detail);
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "", answer = "";
      const applyFrame = frame => {
        let event = "message", data = "";
        frame.split(/\r?\n/).forEach(line => { if (line.startsWith("event:")) event = line.slice(6).trim(); if (line.startsWith("data:")) data += line.slice(5).trim(); });
        if (!data) return;
        const payload = JSON.parse(data);
        if (event === "start") options.onConversation(payload.conversationId);
        if (event === "delta") {
          answer += payload.text || "";
          const bubble = document.getElementById("streamingReply");
          if (bubble) bubble.querySelector("div").innerHTML = context.escape(answer).replace(/\n/g, "<br>");
          root.scrollTop = root.scrollHeight;
        }
        if (event === "tool") { tool.hidden = false; tool.textContent = `${payload.status === "completed" ? "Checked" : "Checking"} ${String(payload.name || "athlete data").replace(/_/g, " ")}…`; }
        if (event === "error") throw new Error(payload.message || "AI Coach could not answer.");
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || "";
        frames.forEach(applyFrame);
        if (done) break;
      }
      if (buffer.trim()) applyFrame(buffer);
      options.onDone();
    } catch (error) {
      if (error.name !== "AbortError") {
        const bubble = document.getElementById("streamingReply");
        if (bubble) bubble.querySelector("div").textContent = error.message || "AI Coach is temporarily unavailable.";
      }
    } finally {
      activeChatController = null; input.disabled = false; tool.hidden = true; input.focus();
    }
  }

  function renderTraining(context) {
    if (requireAccount(context, "Training", "Training plans and workout history are private athlete records.")) return;
    context.app.innerHTML = `<section class="mobile-page training-page">${pageHeader("Personalized development", "Training", "Your active plan, this week's work, and completed sessions.", "fitness_center")}<div id="trainingContent">${loading("Loading training plan…")}</div></section>`;
    if (context.state.access === "preview") {
      renderTrainingPlan(context, demoPlan(), [], []);
      return;
    }
    const version = renderVersion;
    Promise.all([
      context.db.collection("players").doc(context.state.playerId).collection("trainingPlans").get(),
      context.db.collection("players").doc(context.state.playerId).collection("plannedWorkouts").get(),
      context.db.collection("players").doc(context.state.playerId).collection("workoutLogs").get(),
    ]).then(([plansSnap, workoutsSnap, logsSnap]) => {
      if (version !== renderVersion) return;
      const plans = plansSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (timestamp(b.generatedAt)?.valueOf() || 0) - (timestamp(a.generatedAt)?.valueOf() || 0));
      const active = plans.find(plan => plan.status === "active") || null;
      const workouts = workoutsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      active ? renderTrainingPlan(context, active, workouts, logs) : renderTrainingIntake(context);
    }).catch(error => {
      console.error("[training]", error);
      document.getElementById("trainingContent").innerHTML = empty("cloud_off", "Training is unavailable", error.message || "The training records could not be loaded.");
    });
  }

  function currentWeek(plan) {
    const start = new Date(`${plan.startDate}T00:00:00`);
    if (Number.isNaN(start.valueOf())) return 1;
    return Math.min(Math.max(Math.floor((Date.now() - start.valueOf()) / 604800000) + 1, 1), number(plan.horizonWeeks) || (plan.weeks || []).length || 1);
  }

  function renderTrainingPlan(context, plan, workouts, logs) {
    const root = document.getElementById("trainingContent"), weekNumber = currentWeek(plan);
    const weeks = [...(plan.weeks || [])].sort((a, b) => number(a.weekNumber) - number(b.weekNumber));
    const week = weeks.find(item => number(item.weekNumber) === weekNumber) || weeks[0] || {};
    const weekWorkouts = workouts.filter(item => item.planId === plan.id && number(item.weekNumber) === weekNumber);
    const logMap = new Map(logs.map(log => [log.id, log]));
    root.innerHTML = `<section class="training-summary portal-card"><div><p class="eyebrow">Week ${weekNumber} of ${number(plan.horizonWeeks) || weeks.length}</p><h2>${context.escape(week.theme || "Your training week")}</h2><p>${context.escape(week.focus || plan.assessment?.summary || "Build consistency and retest your progress.")}</p></div><div class="week-ring"><strong>${weekNumber}</strong><small>week</small></div></section>
      <div class="training-grid">
        <section class="portal-card"><div class="card-heading"><div><h2>This week</h2><p>${context.escape(week.progressionNote || "Complete the planned exposures at a sustainable intensity.")}</p></div><button class="primary-mini" id="buildWorkout" type="button">Create workout</button></div><div class="training-targets">${(week.targets || []).map(target => `<article><span>${context.escape(String(target.domain || "Training").replace(/([A-Z])/g, " $1"))}</span><strong>${number(target.exposures) || 0}×</strong><small>${context.escape(target.note || "weekly exposure")}</small></article>`).join("") || empty("target", "No targets listed", "Open the full plan below for this week's drills.")}</div></section>
        <section class="portal-card"><div class="card-heading"><div><h2>Focus areas</h2><p>Why this plan was built</p></div></div><div class="focus-list">${(plan.focusAreas || []).map(item => `<article><span class="material-symbols-outlined">center_focus_strong</span><div><strong>${context.escape(String(item.domain || "Development").replace(/([A-Z])/g, " $1"))}</strong><p>${context.escape(item.rationale || "")}</p></div></article>`).join("") || `<p class="muted-copy">${context.escape(plan.assessment?.summary || "Personalized from your current stats.")}</p>`}</div></section>
      </div>
      <section class="portal-card planned-workouts"><div class="card-heading"><div><h2>Workouts</h2><p>Generated from the current plan</p></div></div><div id="workoutList">${weekWorkouts.length ? weekWorkouts.map(workout => workoutMarkup(context, workout, logMap.get(workout.id))).join("") : empty("exercise", "No workout built yet", "Create a workout based on your available time and energy.")}</div></section>
      <section class="portal-card full-plan"><div class="card-heading"><div><h2>Full ${number(plan.horizonWeeks) || weeks.length}-week plan</h2><p>${context.escape(plan.intake?.daysPerWeek ? `${plan.intake.daysPerWeek} days per week · ${plan.intake.minutesPerSession || 60} minutes` : "Week-by-week progression")}</p></div></div><div class="plan-weeks">${weeks.map(item => `<details ${number(item.weekNumber) === weekNumber ? "open" : ""}><summary><span>Week ${number(item.weekNumber)}</span><strong>${context.escape(item.theme || "Training week")}</strong><span class="material-symbols-outlined">expand_more</span></summary><div><p>${context.escape(item.focus || item.progressionNote || "")}</p><div class="plan-drills">${(item.drills || []).map(drill => `<article><div><strong>${context.escape(drill.name || drill.drillId || "Drill")}</strong><small>${context.escape(String(drill.domain || "").replace(/([A-Z])/g, " $1"))}</small></div><span>${number(drill.sets) || 0} × ${number(drill.reps) || 0} ${context.escape(drill.repUnit || "reps")}</span></article>`).join("") || `<p class="muted-copy">Retest week · complete the measured drills in Drill Results.</p>`}</div></div></details>`).join("")}</div></section>`;
    document.getElementById("buildWorkout")?.addEventListener("click", () => showWorkoutBuilder(context, plan));
    bindWorkoutActions(context, weekWorkouts, logMap);
  }

  function workoutMarkup(context, workout, log) {
    const ended = Boolean(log?.endedAt), started = Boolean(log?.startedAt);
    return `<article class="workout-card" data-workout="${context.escape(workout.id)}"><header><div><span>${number(workout.estimatedMinutes) || number(workout.params?.timeAvailableMinutes) || 30} min</span><strong>${context.escape(workout.intro || "Personalized workout")}</strong></div><span class="workout-status ${ended ? "done" : started ? "active" : ""}">${ended ? "Completed" : started ? "In progress" : "Ready"}</span></header><div class="workout-blocks">${(workout.blocks || []).sort((a, b) => number(a.order) - number(b.order)).map(block => {
      const blockLog = (log?.blocks || []).find(item => item.blockId === block.blockId);
      return `<article class="workout-block ${blockLog?.status === "done" ? "done" : ""}"><span class="block-kind">${context.escape(block.kind || "main")}</span><div><strong>${context.escape(block.name || block.drillId || "Training block")}</strong><small>${number(block.sets) || 0} sets · ${number(block.reps) || 0} ${context.escape(block.repUnit || "reps")} · ${number(block.restSeconds) || 0}s rest</small></div>${started && !ended ? `<button type="button" data-complete-block="${context.escape(block.blockId)}" aria-label="Mark ${context.escape(block.name || "block")} complete"><span class="material-symbols-outlined">${blockLog?.status === "done" ? "check_circle" : "radio_button_unchecked"}</span></button>` : ""}</article>`;
    }).join("")}</div><footer>${!started ? `<button class="primary-mini" type="button" data-begin-workout>Begin workout</button>` : !ended ? `<button class="primary-mini" type="button" data-end-workout>Finish workout</button>` : `<span>Finished ${dateText(log.endedAt)}</span>`}</footer></article>`;
  }

  function bindWorkoutActions(context, workouts, logMap) {
    document.querySelectorAll("[data-workout]").forEach(card => {
      const workout = workouts.find(item => item.id === card.dataset.workout), ref = context.db.collection("players").doc(context.state.playerId).collection("workoutLogs").doc(workout.id);
      card.querySelector("[data-begin-workout]")?.addEventListener("click", async () => {
        await ref.set({ schemaVersion: 1, planId: workout.planId, weekNumber: number(workout.weekNumber) || 1, startedAt: firebase.firestore.FieldValue.serverTimestamp(), blocks: [] });
        context.notify("Workout started"); renderTraining(context);
      });
      card.querySelector("[data-end-workout]")?.addEventListener("click", async () => {
        await ref.update({ endedAt: firebase.firestore.FieldValue.serverTimestamp(), endReason: "completed" });
        context.notify("Workout completed"); renderTraining(context);
      });
      card.querySelectorAll("[data-complete-block]").forEach(button => button.addEventListener("click", async () => {
        const log = logMap.get(workout.id) || {}, block = (workout.blocks || []).find(item => item.blockId === button.dataset.completeBlock);
        const blocks = [...(log.blocks || []).filter(item => item.blockId !== block.blockId), { blockId: block.blockId, drillId: block.drillId || "", domain: block.domain || "", targetSets: number(block.sets) || 0, setsCompleted: number(block.sets) || 0, status: "done" }];
        await ref.update({ blocks }); context.notify(`${block.name || "Block"} completed`); renderTraining(context);
      }));
    });
  }

  function showWorkoutBuilder(context, plan) {
    const root = document.getElementById("workoutList");
    root.innerHTML = `<form class="workout-builder" id="workoutBuilder"><h3>Build today's workout</h3><label>Time available<select name="minutes"><option>15</option><option selected>30</option><option>45</option><option>60</option><option>75</option></select></label><label>Energy<select name="energy"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option></select></label><button class="primary-cta" type="submit">Build workout</button><p id="workoutBuilderStatus"></p></form>`;
    document.getElementById("workoutBuilder").addEventListener("submit", async event => {
      event.preventDefault(); const form = event.currentTarget, status = document.getElementById("workoutBuilderStatus");
      status.textContent = "Building a workout from your plan…"; form.querySelector("button").disabled = true;
      try {
        const job = await submitLlmJob(context, "build_workout", { planId: plan.id, timeAvailableMinutes: Number(form.minutes.value), energy: form.energy.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        await waitForJob(context, job.id, status); context.notify("Workout ready"); renderTraining(context);
      } catch (error) { status.textContent = error.message || "Could not build the workout."; form.querySelector("button").disabled = false; }
    });
  }

  function renderTrainingIntake(context) {
    const root = document.getElementById("trainingContent");
    const goals = [["speedAgility", "Speed & agility"], ["dribbling", "Dribbling"], ["passing", "Passing"], ["firstTouch", "First touch"], ["shooting", "Shooting"], ["strengthPower", "Strength & power"]];
    root.innerHTML = `<section class="portal-card training-intake"><div class="intake-intro"><span class="material-symbols-outlined">auto_awesome</span><h2>Build your training plan</h2><p>Answer a few questions. PoseTek combines your goals with the athlete's measured results to create a 4–12 week program.</p></div><form id="trainingIntakeForm"><fieldset><legend>Choose up to two goals</legend><div class="goal-options">${goals.map(([value, label]) => `<label><input type="checkbox" name="goals" value="${value}"><span>${label}</span></label>`).join("")}</div></fieldset><label>Training days per week<input type="range" name="days" min="1" max="6" value="3"><output id="daysOutput">3 days</output></label><label>Training setting<select name="setting"><option value="solo">Solo</option><option value="partner">With a partner</option><option value="halfAndHalf">Half solo, half partner</option><option value="team">Team</option></select></label><label>Program length<select name="weeks"><option value="4">4 weeks</option><option value="6" selected>6 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option></select></label><label>Anything else you want to improve?<textarea name="freeText" maxlength="500" placeholder="Optional"></textarea></label><label class="pain-check"><input type="checkbox" name="pain"><span>I currently have pain that affects training</span></label><button class="primary-cta" type="submit">Generate my plan</button><p id="planGenerationStatus"></p></form></section>`;
    const form = document.getElementById("trainingIntakeForm"), days = form.days;
    days.addEventListener("input", () => document.getElementById("daysOutput").textContent = `${days.value} days`);
    form.addEventListener("change", event => {
      if (event.target.name !== "goals") return;
      const checked = [...form.querySelectorAll('[name="goals"]:checked')];
      if (checked.length > 2) { event.target.checked = false; context.notify("Choose up to two goals"); }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); const status = document.getElementById("planGenerationStatus");
      const chosen = [...form.querySelectorAll('[name="goals"]:checked')].map(input => input.value);
      if (!chosen.length) { status.textContent = "Choose at least one training goal."; return; }
      if (form.pain.checked) { status.textContent = "Pause training and check with a qualified medical professional before generating a plan."; return; }
      status.textContent = "Reviewing results and building your plan week by week…";
      try {
        const profile = window.PoseTekAthleteStats.buildProfile(context.allStatsReps());
        const intake = { goals: chosen, freeTextGoals: form.freeText.value.trim() || null, daysPerWeek: Number(form.days.value), minutesPerSession: 60, setting: form.setting.value, equipment: ["ball", "cones", "markers", "goal", "timer", "wall"], level: profile.overall >= 100 ? "performance" : profile.overall >= 75 ? "club" : "foundation", horizonWeeks: Number(form.weeks.value), painFlag: false };
        const job = await submitLlmJob(context, "generate_training_plan", { statsProfile: statsSnapshot(profile), intake, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        await waitForJob(context, job.id, status); context.notify("Training plan ready"); renderTraining(context);
      } catch (error) { status.textContent = error.message || "Could not generate the plan."; }
    });
  }

  function statsSnapshot(profile) {
    return { schemaVersion: 1, benchmarkProfile: { ageBand: "senior", gender: "unspecified", isDefaulted: true }, totalReps: profile.totalReps, totalSessions: profile.totalSessions, ...(profile.overall === null ? {} : { overallScore: Math.max(0, Math.min(400, Number(profile.overall.toFixed(2)))) }), axes: profile.axes.map(axis => ({ axis: axis.key, repCount: axis.repCount, missingDrills: [], ...(axis.score === null ? {} : { score: Math.max(0, Math.min(400, Number(axis.score.toFixed(2)))) }) })), drills: [] };
  }

  async function submitLlmJob(context, capability, params) {
    const ref = context.db.collection("llmJobs").doc();
    await ref.set({ schemaVersion: 1, capability, playerId: context.state.playerId, params, requestedByUid: context.auth.currentUser.uid, clientVersion: "1.1+4", status: "pending", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return ref;
  }

  function waitForJob(context, jobId, statusNode) {
    return new Promise((resolve, reject) => {
      const unsubscribe = context.db.collection("llmJobs").doc(jobId).onSnapshot(snapshot => {
        const job = snapshot.data() || {};
        if (statusNode) statusNode.textContent = job.status === "running" ? "Building your plan…" : "Waiting for the training engine…";
        if (job.status === "complete") { unsubscribe(); resolve(job); }
        if (job.status === "failed") { unsubscribe(); reject(new Error(job.error?.detail || job.error?.message || "The training engine could not finish.")); }
      }, error => { unsubscribe(); reject(error); });
      cleanupTasks.push(unsubscribe);
    });
  }

  function demoPlan() {
    return { id: "preview-plan", status: "active", startDate: new Date().toISOString().slice(0, 10), horizonWeeks: 6, intake: { daysPerWeek: 3, minutesPerSession: 60 }, assessment: { summary: "Build first-step speed while maintaining power and ball control." }, focusAreas: [{ domain: "speedAgility", rationale: "Your acceleration has the clearest opportunity for improvement." }, { domain: "strengthPower", rationale: "Power work supports sprint and jump performance." }], weeks: Array.from({ length: 6 }, (_, index) => ({ weekNumber: index + 1, theme: index === 5 ? "Retest and review" : `Build the base ${index + 1}`, focus: "Quality movement, controlled volume, and consistent technique.", progressionNote: "Complete each exposure with full recovery.", targets: [{ domain: "speedAgility", exposures: 2, note: "short, high-quality efforts" }, { domain: "strengthPower", exposures: 1, note: "explosive movement" }], drills: index === 5 ? [] : [{ drillId: "SPD-010", name: "Acceleration starts", domain: "speedAgility", sets: 4, reps: 3, repUnit: "reps", restSeconds: 60 }] })) };
  }

  function renderLeaderboards(context) {
    if (requireAccount(context, "Leaderboards", "Team standings are visible only to connected athletes and coaches.")) return;
    context.app.innerHTML = `<section class="mobile-page leaderboard-page">${pageHeader("Team comparison", "Leaderboards", "See where this athlete ranks across measured drills.", "leaderboard")}<nav class="leaderboard-tabs" id="leaderboardTabs">${LEADERBOARD_CATEGORIES.map((item, index) => `<button type="button" class="${index ? "" : "active"}" data-board="${item.key}"><span class="material-symbols-outlined">${item.icon}</span>${item.label}</button>`).join("")}</nav><div id="leaderboardContent">${loading("Building team standings…")}</div></section>`;
    if (context.state.access === "preview") {
      const team = [{ id: "one", name: "Maya Chen", value: 4.08 }, { id: context.state.playerId, name: context.fullName(context.state.athlete), value: 4.42 }, { id: "three", name: "Alex Morgan", value: 4.63 }, { id: "four", name: "Sam Lee", value: 4.81 }];
      setupLeaderboards(context, { changeOfDirection: team, sprint: team.map((p, i) => ({ ...p, value: 20.1 - i })), jump: team.map((p, i) => ({ ...p, value: 24.8 - i * 1.4 })), shooting: team.map((p, i) => ({ ...p, value: 67.2 - i * 2.2 })), dribbling: team.map((p, i) => ({ ...p, value: 5.01 + i * .2 })) });
      return;
    }
    loadTeamStandings(context).then(boards => setupLeaderboards(context, boards)).catch(error => {
      console.error("[leaderboards]", error); document.getElementById("leaderboardContent").innerHTML = empty("groups", "No team leaderboard available", "This athlete must be connected to a coach roster before team standings can be shown.");
    });
  }

  async function loadTeamStandings(context) {
    let coachDoc = await context.db.collection("coaches").doc(context.auth.currentUser.uid).get();
    if (!coachDoc.exists) {
      const own = await context.db.collection("coaches").where("userUID", "==", context.auth.currentUser.uid).limit(1).get();
      if (!own.empty) coachDoc = own.docs[0];
    }
    if (!coachDoc.exists) {
      const query = await context.db.collection("coaches").where("members", "array-contains", context.state.playerId).limit(1).get();
      if (query.empty) throw new Error("No connected team");
      coachDoc = query.docs[0];
    }
    const ids = [...new Set([...(coachDoc.data().members || []), context.state.playerId])];
    const players = await Promise.all(ids.map(async id => {
      const [player, reps] = await Promise.all([context.db.collection("players").doc(id).get(), context.db.collection("players").doc(id).collection("reps").get()]);
      return { id, name: context.fullName(player.data() || {}), reps: reps.docs.map(doc => doc.data()) };
    }));
    return Object.fromEntries(LEADERBOARD_CATEGORIES.map(category => [category.key, players.map(player => {
      const values = player.reps.filter(rep => {
        const type = rep.repType || rep.drillType;
        return category.key === "shooting" ? ["deadballShot", "shooting", "side_kick"].includes(type) : type === category.key;
      }).map(rep => category.fields.map(field => number(rep[field])).find(value => value !== null)).filter(value => value !== undefined && value !== null);
      if (!values.length) return null;
      const raw = category.lower ? Math.min(...values) : Math.max(...values);
      return { id: player.id, name: player.name, value: category.convert ? category.convert(raw) : raw };
    }).filter(Boolean)]));
  }

  function setupLeaderboards(context, boards) {
    const renderBoard = key => {
      const category = LEADERBOARD_CATEGORIES.find(item => item.key === key), rows = [...(boards[key] || [])].sort((a, b) => category.lower ? a.value - b.value : b.value - a.value);
      let prior = null, rank = 0;
      rows.forEach((row, index) => { if (prior === null || Math.abs(row.value - prior) > .0001) rank = index + 1; row.rank = rank; prior = row.value; });
      const athlete = rows.find(row => row.id === context.state.playerId), better = athlete ? rows.filter(row => category.lower ? row.value > athlete.value : row.value < athlete.value).length : 0;
      const percentile = rows.length > 1 && athlete ? Math.round(better / (rows.length - 1) * 100) : null;
      document.getElementById("leaderboardContent").innerHTML = rows.length ? `<section class="leaderboard-summary"><article><small>Your rank</small><strong>${athlete ? `#${athlete.rank}` : "—"}</strong><span>of ${rows.length}</span></article><article><small>Team percentile</small><strong>${percentile === null ? "—" : `${percentile}%`}</strong><span>${category.lower ? "lower is faster" : "higher is better"}</span></article><article><small>Personal best</small><strong>${athlete ? athlete.value.toFixed(category.unit === "s" ? 2 : 1) : "—"}</strong><span>${category.unit}</span></article></section><section class="portal-card standings-card"><div class="card-heading"><div><h2>${category.label} standings</h2><p>Best verified result per athlete</p></div></div><div class="standings-list">${rows.map(row => `<article class="standing-row ${row.id === context.state.playerId ? "current" : ""}"><span class="rank">${row.rank}</span><span class="athlete-avatar">${initials(row.name)}</span><span><strong>${context.escape(row.name)}${row.id === context.state.playerId ? " · You" : ""}</strong><small>${row.rank === 1 ? "Team leader" : `Rank ${row.rank}`}</small></span><strong>${row.value.toFixed(category.unit === "s" ? 2 : 1)} <small>${category.unit}</small></strong></article>`).join("")}</div></section>` : `<section class="portal-card">${empty("leaderboard", `No ${category.label.toLowerCase()} standings yet`, "Team members need at least one completed rep in this drill.")}</section>`;
    };
    document.querySelectorAll("[data-board]").forEach(button => button.addEventListener("click", () => { document.querySelectorAll("[data-board]").forEach(item => item.classList.toggle("active", item === button)); renderBoard(button.dataset.board); }));
    renderBoard("changeOfDirection");
  }

  function render(view, context) {
    clean();
    if (view === "profile") renderBodyProfile(context);
    else if (view === "aiCoach") renderAiCoach(context);
    else if (view === "training") renderTraining(context);
    else if (view === "leaderboards") renderLeaderboards(context);
    else return false;
    return true;
  }

  window.PoseTekMobilePages = { render, clean, VIEW_LABELS };
})();
