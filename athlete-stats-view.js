(function () {
  "use strict";

  const RADAR_CEILING = 130;
  const D1_REFERENCES = {
    broadJumpDistance: 2.444,
    codTotalTime: 4.893617,
    codTurnTime: 1.542553
  };

  const AXES = [
    { key: "power", label: "Power", icon: "bolt", drills: "Broad Jump and Jump" },
    { key: "speed", label: "Speed", icon: "sprint", drills: "Sprint" },
    { key: "agility", label: "Agility", icon: "switch_access_shortcut", drills: "Change of Direction" },
    { key: "ballControl", label: "Ball Control", icon: "sports_soccer", drills: "Dribbling" },
    { key: "striking", label: "Striking", icon: "target", drills: "Shooting" }
  ];

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

  function score(value, reference, lowerIsBetter) {
    if (!value || !reference) return null;
    return 100 * (lowerIsBetter ? reference / value : value / reference);
  }

  function scoreDelta(reps, field, reference, lowerIsBetter) {
    const values = [...reps]
      .sort((left, right) => (left.createdAtMillis || 0) - (right.createdAtMillis || 0))
      .map(rep => number(rep[field]))
      .filter(value => value !== null)
      .map(value => score(value, reference, lowerIsBetter));
    if (values.length < 2) return null;
    const split = Math.floor(values.length / 2);
    return mean(values.slice(split)) - mean(values.slice(0, split));
  }

  function bestMetric(reps, definition) {
    const values = reps.map(rep => number(rep[definition.field])).filter(value => value !== null);
    if (!values.length) return null;
    const best = definition.lowerIsBetter ? Math.min(...values) : Math.max(...values);
    return {
      ...definition,
      best,
      score: score(best, definition.reference, definition.lowerIsBetter),
      repCount: values.length,
      delta: scoreDelta(reps, definition.field, definition.reference, definition.lowerIsBetter)
    };
  }

  function sessionCount(reps) {
    return new Set(reps.map(rep => `${rep._statsDrill || rep.repType || rep.drillType}:${rep.sessionNumber || 1}`)).size;
  }

  function bestRep(reps, field, lowerIsBetter = true) {
    return reps.reduce((best, rep) => {
      const value = number(rep[field]);
      if (value === null) return best;
      if (!best) return rep;
      const bestValue = number(best[field]);
      return lowerIsBetter ? value < bestValue ? rep : best : value > bestValue ? rep : best;
    }, null);
  }

  function buildProfile(reps) {
    const broadReps = reps.filter(rep => (rep._statsDrill || rep.repType || rep.drillType) === "broadJump");
    const codReps = reps.filter(rep => (rep._statsDrill || rep.repType || rep.drillType) === "changeOfDirection");
    const broadMetrics = [bestMetric(broadReps, {
      key: "broadJumpDistance",
      field: "broadJumpDistance",
      label: "Broad Jump",
      reference: D1_REFERENCES.broadJumpDistance,
      lowerIsBetter: false,
      format: value => `${(value * 3.28084).toFixed(1)} ft`
    })].filter(Boolean);
    const codMetrics = [
      bestMetric(codReps, {
        key: "codTotalTime",
        field: "totalTime",
        label: "Shuttle Time",
        reference: D1_REFERENCES.codTotalTime,
        lowerIsBetter: true,
        format: value => `${value.toFixed(2)} s`
      }),
      bestMetric(codReps, {
        key: "codTurnTime",
        field: "phase2Time",
        label: "Turn Phase",
        reference: D1_REFERENCES.codTurnTime,
        lowerIsBetter: true,
        format: value => `${value.toFixed(2)} s`
      })
    ].filter(Boolean);

    const power = mean(broadMetrics.map(metric => metric.score));
    const agility = mean(codMetrics.map(metric => metric.score));
    const bestCodRep = bestRep(codReps, "totalTime", true);
    const axes = AXES.map(axis => ({
      ...axis,
      score: axis.key === "power" ? power : axis.key === "agility" ? agility : null,
      repCount: axis.key === "power" ? broadReps.length : axis.key === "agility" ? codReps.length : 0
    }));
    const scoredAxes = axes.filter(axis => axis.score !== null);
    return {
      axes,
      overall: mean(scoredAxes.map(axis => axis.score)),
      totalReps: broadReps.length + codReps.length,
      totalSessions: sessionCount([...broadReps, ...codReps]),
      broad: { key: "broadJump", title: "Broad Jump", icon: "arrow_right_alt", reps: broadReps, metrics: broadMetrics, score: power },
      cod: { key: "changeOfDirection", title: "Change of Direction", icon: "switch_access_shortcut", reps: codReps, metrics: codMetrics, score: agility, bestRep: bestCodRep }
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
      ? `<circle class="stats-radar-marker" cx="${current.x}" cy="${current.y}" r="5" data-stats-axis="${axes[index].key}" tabindex="0" role="button" aria-label="View ${escapeHtml(axes[index].label)} summary" />`
      : "").join("");
    const labels = axes.map((axis, index) => {
      const labelPoint = point(index, 1.34);
      const scoreText = axis.score === null ? "—" : Math.round(axis.score);
      return `<g class="stats-radar-label${axis.score === null ? " missing" : ""}" transform="translate(${labelPoint.x} ${labelPoint.y})" data-stats-axis="${axis.key}" tabindex="0" role="button" aria-label="View ${escapeHtml(axis.label)} summary"><text class="axis-name" text-anchor="middle" y="-2">${escapeHtml(axis.label)}</text><text class="axis-score" text-anchor="middle" y="13">${scoreText}</text></g>`;
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

  function phaseMetric(label, value, className) {
    const seconds = number(value);
    return `<div class="stats-phase-metric ${className}"><small>${escapeHtml(label)}</small><strong>${seconds === null ? "—" : `${seconds.toFixed(2)} s`}</strong></div>`;
  }

  function axisDetail(axis, profile) {
    const hasData = axis.score !== null;
    let message = hasData
      ? `${Math.round(axis.score)} vs D1, from ${axis.key === "power" ? "Broad Jump" : "Change of Direction"} across ${axis.repCount} ${axis.repCount === 1 ? "rep" : "reps"}.`
      : `No data yet — record ${axis.drills}.`;
    if (hasData && axis.repCount < 3) message += " Limited data.";
    const phases = axis.key === "agility" && profile.cod.bestRep ? `<div class="stats-phase-grid" aria-label="Best agility rep phases">
      ${phaseMetric("Start", profile.cod.bestRep.phase1Time, "start")}
      ${phaseMetric("Turn", profile.cod.bestRep.phase2Time, "turn")}
      ${phaseMetric("End", profile.cod.bestRep.phase3Time, "end")}
      ${phaseMetric("Total time", profile.cod.bestRep.totalTime, "total")}
    </div><p class="stats-phase-note">Phase times are from the athlete's fastest recorded change-of-direction rep.</p>` : "";
    return `<section class="stats-axis-detail" data-axis-panel="${axis.key}" hidden>
      <span class="stats-axis-detail-icon material-symbols-outlined">${axis.icon}</span>
      <div class="stats-axis-detail-copy"><h3>${escapeHtml(axis.label)}</h3><p>${escapeHtml(message)}</p>${phases}</div>
    </section>`;
  }

  function bind(root) {
    if (!root || root.dataset.statsBound === "true") return;
    root.dataset.statsBound = "true";
    const selectAxis = key => {
      root.querySelector(".stats-axis-prompt")?.toggleAttribute("hidden", true);
      root.querySelectorAll("[data-axis-panel]").forEach(panel => panel.toggleAttribute("hidden", panel.dataset.axisPanel !== key));
      root.querySelectorAll("[data-stats-axis]").forEach(control => {
        const selected = control.dataset.statsAxis === key;
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
    const breakdowns = [profile.broad, profile.cod].sort((left, right) => Number(right.metrics.length > 0) - Number(left.metrics.length > 0));
    const athlete = options.athlete || {};
    const athleteDisplayName = options.athleteName || "Athlete";
    return `<section class="athlete-stats" aria-label="Athlete Stats">
      <section class="stats-hero-card">
        <div class="stats-athlete-identity">
          <span class="stats-athlete-avatar">${escapeHtml(athleteInitials(athleteDisplayName))}</span>
          <span class="stats-athlete-name"><small>Athlete profile</small><strong>${escapeHtml(athleteDisplayName)}</strong><em>${profile.totalReps} reps · ${profile.totalSessions} sessions</em></span>
          <span class="stats-athlete-measure"><small>Height</small><strong>${escapeHtml(formatHeight(athlete.height))}</strong></span>
          <span class="stats-athlete-measure"><small>Weight</small><strong>${escapeHtml(formatWeight(athlete.weight))}</strong></span>
        </div>
        <div class="stats-score-block"><p>Overall vs D1</p><div><strong>${profile.overall === null ? "—" : Math.round(profile.overall)}</strong><span>/ 100</span></div>${profile.overall === null ? `<small>Record a drill to generate your profile</small>` : `<span class="benchmark-band ${band(profile.overall).key}"><span class="material-symbols-outlined">${band(profile.overall).icon}</span>${band(profile.overall).label}</span>`}</div>
        <div class="stats-athlete-block"><small><span class="material-symbols-outlined">flag</span>General D1 standard</small></div>
        <div class="stats-focus-grid">
          ${strength ? summaryRow("star", "Strength", `${strength.label} · ${Math.round(strength.score)} vs D1`, "lime") : ""}
          ${focus ? summaryRow("center_focus_strong", "Focus area", `${focus.label} · ${Math.round(focus.score)} vs D1`, "orange") : ""}
          ${missing ? summaryRow("add_circle", "Missing data", missing, "cyan") : ""}
        </div>
      </section>
      <section class="stats-radar-card">
        <header><div><h2>Skill Map</h2><p>Your profile against the D1 standard</p></div><span class="stats-recorded-count">${ranked.length}/${profile.axes.length} recorded</span></header>
        ${radarSvg(profile.axes)}
        <div class="stats-radar-legend"><span class="you"><i></i>You</span><span class="d1"><i></i>D1 standard</span><span class="untested"><i></i>Not tested</span></div>
        <div class="stats-axis-details" aria-live="polite">
          <p class="stats-axis-prompt"><span class="material-symbols-outlined">touch_app</span>Select any skill on the chart to view its summary.</p>
          ${profile.axes.map(axis => axisDetail(axis, profile)).join("")}
        </div>
        <p class="stats-radar-note">Power currently reflects Broad Jump. Agility reflects Change of Direction. The remaining axes will activate as the placeholder drills are connected.</p>
      </section>
      <div class="stats-section-heading"><h2>D1 Comparison</h2><p>Every available component metric against the D1 standard</p></div>
      <div class="stats-breakdowns">${breakdowns.map(breakdown).join("")}</div>
      <p class="stats-methodology"><span class="material-symbols-outlined">info</span>Scores are indexed so 100 equals the D1 reference for each metric. These general reference values match the mobile app’s provisional benchmark set and will be replaced as measured cohort data grows.</p>
    </section>`;
  }

  window.PoseTekAthleteStats = { render, buildProfile, bind };
})();
