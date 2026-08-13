(function () {
  "use strict";

  const RADAR_CEILING = 130;
  const benchmarks = window.PoseTekBenchmarks;
  if (!benchmarks) throw new Error("PoseTek benchmark definitions were not loaded.");

  const AXES = [
    { key: "power", label: "Power", icon: "bolt", drills: "Broad Jump and Jump" },
    { key: "speed", label: "Speed", icon: "sprint", drills: "Sprint" },
    { key: "agility", label: "Agility", icon: "switch_access_shortcut", drills: "Change of Direction" },
    { key: "ballControl", label: "Ball Control", icon: "sports_soccer", drills: "Dribbling" },
    { key: "striking", label: "Striking", icon: "target", drills: "Shooting" }
  ];

  const METRICS = [
    definition("ballSpeed", "striking", ["shooting"], ["velocity"]),
    definition("shotAccuracy", "striking", ["shooting"], []),
    definition("broadJumpDistance", "power", ["broadJump"], ["broadJumpDistance"]),
    definition("verticalJumpHeight", "power", ["jump"], ["jumpHeight"]),
    definition("sprintMaxAcceleration", "speed", ["sprint"], ["max_acceleration", "maxAcceleration"]),
    definition("sprintMaxSpeed", "speed", ["sprint"], ["max_velocity", "maxVelocity"]),
    definition("sprintCompletionTime", "speed", ["sprint"], ["totalTime"]),
    definition("dribbleTotalTime", "ballControl", ["dribbling"], ["totalTime"]),
    definition("dribbleBallControl", "ballControl", ["dribbling"], ["avgBallDistance"]),
    definition("dribbleOutboundTime", "ballControl", ["dribbling"], ["phase1Time"]),
    definition("dribbleTurnTime", "ballControl", ["dribbling"], ["phase2Time"]),
    definition("dribbleReturnTime", "ballControl", ["dribbling"], ["phase3Time"]),
    definition("codTotalTime", "agility", ["changeOfDirection"], ["totalTime"]),
    definition("codOutboundTime", "agility", ["changeOfDirection"], ["phase1Time"]),
    definition("codTurnTime", "agility", ["changeOfDirection"], ["phase2Time"]),
    definition("codReturnTime", "agility", ["changeOfDirection"], ["phase3Time"])
  ];

  function definition(key, axis, drills, fields) {
    const benchmark = benchmarks.get(key);
    return {
      key,
      axis,
      drills,
      fields,
      label: benchmark.label,
      reference: benchmark.reference,
      lowerIsBetter: benchmark.direction === "lower",
      placeholder: benchmark.placeholder,
      format: value => benchmarks.format(key, value)
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function number(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function drillFor(rep) {
    return rep._statsDrill || rep.repType || rep.drillType;
  }

  function metricValue(rep, definition) {
    for (const field of definition.fields) {
      const value = number(rep[field]);
      if (value !== null) return value;
    }
    return null;
  }

  function scoreDelta(reps, definition) {
    const values = [...reps]
      .sort((left, right) => (left.createdAtMillis || 0) - (right.createdAtMillis || 0))
      .map(rep => metricValue(rep, definition))
      .filter(value => value !== null)
      .map(value => benchmarks.score(definition.key, value));
    if (values.length < 2) return null;
    const split = Math.floor(values.length / 2);
    return mean(values.slice(split)) - mean(values.slice(0, split));
  }

  function bestMetric(reps, definition) {
    if (definition.placeholder || !definition.reference) return null;
    const values = reps.map(rep => metricValue(rep, definition)).filter(value => value !== null);
    if (!values.length) return null;
    const best = definition.lowerIsBetter ? Math.min(...values) : Math.max(...values);
    return {
      ...definition,
      best,
      score: benchmarks.score(definition.key, best),
      repCount: values.length,
      delta: scoreDelta(reps, definition)
    };
  }

  function sessionCount(reps) {
    return new Set(reps.map(rep => `${rep._statsDrill || rep.repType || rep.drillType}:${rep.sessionNumber || 1}`)).size;
  }

  function buildProfile(reps) {
    const sections = {};
    AXES.forEach(axis => {
      const slots = METRICS.filter(metric => metric.axis === axis.key);
      const drillKeys = new Set(slots.flatMap(metric => metric.drills));
      const sectionReps = reps.filter(rep => drillKeys.has(drillFor(rep)));
      const availableByKey = new Map();
      slots.forEach(slot => {
        const metricReps = sectionReps.filter(rep => slot.drills.includes(drillFor(rep)));
        const result = bestMetric(metricReps, slot);
        if (result) availableByKey.set(slot.key, result);
      });
      const availableMetrics = slots.map(slot => availableByKey.get(slot.key)).filter(Boolean);
      sections[axis.key] = {
        key: axis.key,
        title: axis.label,
        icon: axis.icon,
        reps: sectionReps,
        slots,
        availableByKey,
        metrics: availableMetrics,
        score: mean(availableMetrics.map(metric => metric.score))
      };
    });
    const axes = AXES.map(axis => ({ ...axis, score: sections[axis.key].score, repCount: sections[axis.key].reps.length }));
    const scoredAxes = axes.filter(axis => axis.score !== null);
    return {
      axes,
      overall: mean(scoredAxes.map(axis => axis.score)),
      totalReps: reps.length,
      totalSessions: sessionCount(reps),
      sections
    };
  }

  function band(scoreValue) {
    if (scoreValue >= 100) return { key: "standard", label: "At standard", icon: "verified" };
    if (scoreValue >= 85) return { key: "approaching", label: "Approaching", icon: "trending_up" };
    if (scoreValue >= 65) return { key: "developing", label: "Developing", icon: "monitoring" };
    return { key: "early", label: "Early stage", icon: "pending" };
  }

  function point(index, ratio, radius = 92, centerX = 180, centerY = 148) {
    const angle = (Math.PI * 2 / AXES.length) * index - Math.PI / 2;
    return {
      x: centerX + Math.cos(angle) * radius * ratio,
      y: centerY + Math.sin(angle) * radius * ratio
    };
  }

  function polygon(ratio) {
    return AXES.map((_, index) => {
      const current = point(index, ratio);
      return `${current.x.toFixed(1)},${current.y.toFixed(1)}`;
    }).join(" ");
  }

  function radarSvg(axes) {
    const scored = axes.filter(axis => axis.score !== null);
    const athletePoints = axes.map((axis, index) => axis.score === null ? null : point(index, Math.min(axis.score, RADAR_CEILING) / RADAR_CEILING));
    const polygonMarkup = scored.length >= 3
      ? `<polygon class="stats-radar-athlete" points="${athletePoints.filter(Boolean).map(item => `${item.x},${item.y}`).join(" ")}" />`
      : "";
    const spokes = axes.map((axis, index) => {
      const edge = point(index, 1);
      return `<line class="stats-radar-spoke${axis.score === null ? " missing" : ""}" x1="180" y1="148" x2="${edge.x}" y2="${edge.y}" />`;
    }).join("");
    const markers = athletePoints.map((current, index) => current
      ? `<g class="stats-radar-marker-control" data-stats-axis="${axes[index].key}" tabindex="0" role="button" aria-label="View ${escapeHtml(axes[index].label)} summary"><circle class="stats-radar-marker-hit" cx="${current.x}" cy="${current.y}" r="25" /><circle class="stats-radar-marker" cx="${current.x}" cy="${current.y}" r="5" /></g>`
      : "").join("");
    const labels = axes.map((axis, index) => {
      const labelPoint = point(index, 1.34);
      const scoreText = axis.score === null ? "—" : Math.round(axis.score);
      return `<g class="stats-radar-label${axis.score === null ? " missing" : ""}" transform="translate(${labelPoint.x} ${labelPoint.y})" data-stats-axis="${axis.key}" tabindex="0" role="button" aria-label="View ${escapeHtml(axis.label)} summary"><rect class="stats-radar-label-hit" x="-56" y="-25" width="112" height="56" rx="11" /><text class="axis-name" text-anchor="middle" y="-2">${escapeHtml(axis.label)}</text><text class="axis-score" text-anchor="middle" y="13">${scoreText}</text></g>`;
    }).join("");
    return `<svg class="stats-radar" viewBox="0 0 360 300" role="img" aria-label="Athlete skill map compared with the D1 standard">
      ${[0.25, 0.5, 0.75, 1].map(ratio => `<polygon class="stats-radar-grid" points="${polygon(ratio)}" />`).join("")}
      ${spokes}
      <polygon class="stats-radar-reference" points="${polygon(100 / RADAR_CEILING)}" />
      ${polygonMarkup}${markers}${labels}
    </svg>`;
  }

  function summaryRow(icon, title, detail, tone) {
    return `<div class="stats-summary-row"><span class="stats-summary-icon ${tone} material-symbols-outlined">${icon}</span><span><small>${escapeHtml(title)}</small><strong>${escapeHtml(detail)}</strong></span></div>`;
  }

  function meter(metric) {
    const status = band(metric.score);
    const fill = Math.min(Math.max(metric.score, 0), RADAR_CEILING) / RADAR_CEILING * 100;
    const delta = metric.delta !== null && Math.abs(metric.delta) >= 0.5
      ? `<span class="stats-delta ${metric.delta > 0 ? "up" : "down"}">${metric.delta > 0 ? "↗" : "↘"} ${Math.abs(metric.delta).toFixed(0)} pts</span>`
      : "";
    return `<article class="benchmark-meter">
      <div class="benchmark-title"><strong>${escapeHtml(metric.label)}</strong><span>${escapeHtml(metric.format(metric.best))}</span></div>
      <div class="benchmark-track"><span class="benchmark-fill ${status.key}" style="width:${fill.toFixed(2)}%"></span><i class="benchmark-reference" aria-hidden="true"></i></div>
      <div class="benchmark-meta"><span class="benchmark-band ${status.key}"><span class="material-symbols-outlined">${status.icon}</span>${status.label}</span><span>${Math.round(metric.score)}% of D1</span>${delta}</div>
      <p>D1 standard ${escapeHtml(metric.format(metric.reference))} · best of ${metric.repCount} ${metric.repCount === 1 ? "rep" : "reps"}</p>
    </article>`;
  }

  function breakdown(section) {
    const hasData = section.metrics.length > 0;
    return `<section class="stats-breakdown-card">
      <header><span class="stats-breakdown-icon material-symbols-outlined">${section.icon}</span><span><h3>${escapeHtml(section.title)}</h3><p>${hasData ? `${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} · ${sessionCount(section.reps)} ${sessionCount(section.reps) === 1 ? "session" : "sessions"}` : "Not recorded yet"}</p></span>${section.score === null ? "" : `<span class="stats-drill-score">${Math.round(section.score)}<small>vs D1</small></span>`}</header>
      ${hasData ? `<div class="benchmark-list">${section.metrics.map(meter).join("")}</div>${section.reps.length < 3 ? `<p class="stats-confidence"><span class="material-symbols-outlined">info</span>Based on ${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} — record more for a reliable score.</p>` : ""}` : `<div class="stats-empty"><span class="material-symbols-outlined">add_circle</span><span>Record a ${escapeHtml(section.title.toLowerCase())} to unlock this breakdown.</span></div>`}
    </section>`;
  }

  function unavailableMeter(slot) {
    const standard = slot.reference ? `D1 standard ${slot.format(slot.reference)}` : "D1 standard not published";
    const message = slot.placeholder ? "Measurement not available yet" : "No recorded result";
    return `<article class="benchmark-meter unavailable">
      <div class="benchmark-title"><strong>${escapeHtml(slot.label)}</strong><span>—</span></div>
      <div class="benchmark-track"><span class="benchmark-fill unavailable"></span><i class="benchmark-reference" aria-hidden="true"></i></div>
      <div class="benchmark-meta"><span class="benchmark-band unavailable"><span class="material-symbols-outlined">remove</span>${escapeHtml(message)}</span><span>— vs D1</span></div>
      <p>${escapeHtml(standard)}</p>
    </article>`;
  }

  function standardBreakdown(section) {
    const hasData = section.metrics.length > 0;
    const repSummary = hasData
      ? `${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} · ${sessionCount(section.reps)} ${sessionCount(section.reps) === 1 ? "session" : "sessions"}`
      : "Not recorded yet";
    return `<section class="stats-breakdown-card">
      <header><span class="stats-breakdown-icon material-symbols-outlined">${section.icon}</span><span><h3>${escapeHtml(section.title)}</h3><p>${repSummary}</p></span>${section.score === null ? "" : `<span class="stats-drill-score">${Math.round(section.score)}<small>vs D1</small></span>`}</header>
      <div class="benchmark-list">${section.slots.map(slot => section.availableByKey.get(slot.key) ? meter(section.availableByKey.get(slot.key)) : unavailableMeter(slot)).join("")}</div>
      ${hasData && section.reps.length < 3 ? `<p class="stats-confidence"><span class="material-symbols-outlined">info</span>Based on ${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} — record more for a reliable score.</p>` : ""}
    </section>`;
  }

  function formatHeight(value) {
    const centimeters = number(value);
    if (centimeters === null) return "—";
    const totalInches = Math.round(centimeters / 2.54);
    return `${Math.floor(totalInches / 12)}' ${totalInches % 12}\"`;
  }

  function formatWeight(value) {
    const kilograms = number(value);
    return kilograms === null ? "—" : `${Math.round(kilograms * 2.20462)} lbs`;
  }

  function athleteInitials(name) {
    return String(name || "Athlete").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  }

  function phaseMetric(label, value, className, total, detail) {
    const seconds = number(value);
    const totalSeconds = number(total);
    const ratio = seconds !== null && totalSeconds !== null ? Math.min(seconds / totalSeconds * 100, 100) : 0;
    return `<article class="stats-phase-metric ${className}">
      <div><strong>${escapeHtml(label)}</strong><span>${seconds === null ? "—" : `${seconds.toFixed(2)} s`}</span></div>
      <div class="stats-phase-track"><i style="width:${ratio.toFixed(1)}%"></i></div>
      <p>${escapeHtml(detail || (seconds !== null && totalSeconds !== null ? `${Math.round(ratio)}% of total time` : "Not recorded"))}</p>
    </article>`;
  }

  function agilityBreakdown(profile) {
    const section = profile.cod;
    const rep = section.bestRep;
    const hasData = Boolean(rep);
    const total = rep?.totalTime;
    return `<section class="stats-breakdown-card stats-selected-card" data-breakdown-panel="agility" hidden>
      <header><span class="stats-breakdown-icon material-symbols-outlined">switch_access_shortcut</span><span><h3>Agility</h3><p>${hasData ? `${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} · ${sessionCount(section.reps)} ${sessionCount(section.reps) === 1 ? "session" : "sessions"}` : "Not recorded yet"}</p></span>${section.score === null ? "" : `<span class="stats-drill-score">${Math.round(section.score)}<small>vs D1</small></span>`}</header>
      ${hasData ? `<div class="stats-phase-list" aria-label="Fastest agility rep phases">
        ${phaseMetric("Start", rep.phase1Time, "start", total)}
        ${phaseMetric("Turn", rep.phase2Time, "turn", total)}
        ${phaseMetric("End", rep.phase3Time, "end", total)}
        ${phaseMetric("Total time", total, "total", total, "Fastest recorded agility rep")}
      </div>${section.reps.length < 3 ? `<p class="stats-confidence"><span class="material-symbols-outlined">info</span>Based on ${section.reps.length} ${section.reps.length === 1 ? "rep" : "reps"} — record more for a reliable score.</p>` : ""}` : `<div class="stats-empty"><span class="material-symbols-outlined">add_circle</span><span>Record agility to unlock this breakdown.</span></div>`}
    </section>`;
  }

  function axisBreakdown(axis, profile) {
    return standardBreakdown(profile.sections[axis.key])
      .replace('class="stats-breakdown-card"', 'class="stats-breakdown-card stats-selected-card"')
      .replace("<section", `<section data-breakdown-panel="${axis.key}" hidden`);
  }

  function bind(root) {
    if (!root || root.dataset.statsBound === "true") return;
    root.dataset.statsBound = "true";
    let selectedAxis = null;
    const selectAxis = key => {
      selectedAxis = selectedAxis === key ? null : key;
      root.querySelector(".stats-breakdown-prompt")?.toggleAttribute("hidden", selectedAxis !== null);
      root.querySelectorAll("[data-breakdown-panel]").forEach(panel => panel.toggleAttribute("hidden", panel.dataset.breakdownPanel !== selectedAxis));
      root.querySelectorAll("[data-stats-axis]").forEach(control => {
        const selected = control.dataset.statsAxis === selectedAxis;
        control.classList.toggle("selected", selected);
        control.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    };
    root.querySelectorAll("[data-stats-axis]").forEach(control => {
      control.addEventListener("click", () => selectAxis(control.dataset.statsAxis));
      control.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectAxis(control.dataset.statsAxis);
        }
      });
    });
  }

  function render(options) {
    const profile = buildProfile(Array.isArray(options.reps) ? options.reps : []);
    const ranked = profile.axes.filter(axis => axis.score !== null).sort((left, right) => right.score - left.score);
    const strength = ranked[0];
    const focus = ranked.length > 1 ? ranked[ranked.length - 1] : null;
    const missing = profile.axes.filter(axis => axis.score === null).map(axis => axis.label).join(", ");
    const athlete = options.athlete || {};
    const athleteDisplayName = options.athleteName || "Athlete";
    return `<section class="athlete-stats" aria-label="Athlete Stats">
      <section class="stats-profile-card">
        <div class="stats-athlete-identity">
          <span class="stats-athlete-avatar">${escapeHtml(athleteInitials(athleteDisplayName))}</span>
          <span class="stats-athlete-name"><small>Athlete profile</small><strong>${escapeHtml(athleteDisplayName)}</strong><em>${profile.totalReps} reps · ${profile.totalSessions} sessions</em></span>
          <span class="stats-athlete-measure"><small>Height</small><strong>${escapeHtml(formatHeight(athlete.height))}</strong></span>
          <span class="stats-athlete-measure"><small>Weight</small><strong>${escapeHtml(formatWeight(athlete.weight))}</strong></span>
        </div>
        <div class="stats-focus-grid">
          ${strength ? summaryRow("star", "Strength", `${strength.label} · ${Math.round(strength.score)} vs D1`, "lime") : ""}
          ${focus ? summaryRow("center_focus_strong", "Focus area", `${focus.label} · ${Math.round(focus.score)} vs D1`, "orange") : ""}
          ${missing ? summaryRow("add_circle", "Missing data", missing, "cyan") : ""}
        </div>
        <div class="stats-radar-section">
          <header><div><h2>Skill Map</h2><p>Your profile against the D1 standard</p></div><span class="stats-recorded-count">${ranked.length}/${profile.axes.length} recorded</span></header>
          ${radarSvg(profile.axes)}
          <div class="stats-radar-legend"><span class="you"><i></i>You</span><span class="d1"><i></i>D1 standard</span><span class="untested"><i></i>Not tested</span></div>
        </div>
        <section class="stats-selected-breakdown" aria-live="polite">
          <div class="stats-section-heading"><h2>Skill Breakdown</h2><p>Tap a skill above to view its metrics</p></div>
          <p class="stats-breakdown-prompt"><span class="material-symbols-outlined">touch_app</span>Choose a skill on the chart.</p>
          <div class="stats-breakdowns">${profile.axes.map(axis => axisBreakdown(axis, profile)).join("")}</div>
        </section>
      </section>
      <p class="stats-methodology"><span class="material-symbols-outlined">info</span>Scores are indexed so 100 equals the approved Generation 2 senior D1 reference for each metric. Shooting accuracy is shown as unavailable until a standard is published.</p>
    </section>`;
  }

  window.PoseTekAthleteStats = { render, buildProfile, bind };
})();
