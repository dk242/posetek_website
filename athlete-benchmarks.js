(function () {
  "use strict";

  const MPH_TO_MS = 1 / 2.23694;
  const FEET_TO_M = 1 / 3.28084;
  const INCHES_TO_M = 1 / 39.37007874015748;

  const metrics = Object.freeze({
    ballSpeed: metric("Ball Speed", 75 * MPH_TO_MS, "higher", value => `${(value * 2.23694).toFixed(1)} mph`),
    shotAccuracy: metric("Accuracy", null, "higher", value => `${value.toFixed(0)}%`, true),
    broadJumpDistance: metric("Broad Jump", 6 * FEET_TO_M, "higher", value => `${(value * 3.28084).toFixed(1)} ft`),
    verticalJumpHeight: metric("Vertical Jump", 18 * INCHES_TO_M, "higher", value => `${(value * 39.37007874015748).toFixed(1)} in`),
    sprintMaxAcceleration: metric("Acceleration", 6.2, "higher", value => `${value.toFixed(1)} m/s²`),
    sprintMaxSpeed: metric("Max Speed", 14.2 * MPH_TO_MS, "higher", value => `${(value * 2.23694).toFixed(1)} mph`),
    sprintCompletionTime: metric("Time to Complete", 1.84, "lower", seconds),
    dribbleTotalTime: metric("Completion Time", 6.04, "lower", seconds),
    dribbleBallControl: metric("Ball Proximity", 2.1 * FEET_TO_M, "lower", value => `${(value * 3.28084).toFixed(1)} ft`),
    dribbleOutboundTime: metric("Outbound", 2.41, "lower", seconds),
    dribbleTurnTime: metric("Turn", 2.25, "lower", seconds),
    dribbleReturnTime: metric("Return", 1.38, "lower", seconds),
    codTotalTime: metric("Total Time", 4.68, "lower", seconds),
    codOutboundTime: metric("Outbound", 2.10, "lower", seconds),
    codTurnTime: metric("Turn", 1.11, "lower", seconds),
    codReturnTime: metric("Return", 1.72, "lower", seconds)
  });

  function seconds(value) {
    return `${value.toFixed(2)} s`;
  }

  function metric(label, reference, direction, format, placeholder = false) {
    return Object.freeze({ label, reference, direction, format, placeholder });
  }

  function get(key) {
    return metrics[key] || null;
  }

  function score(key, value) {
    const definition = get(key);
    const measured = Number(value);
    if (!definition || !Number.isFinite(measured) || measured <= 0 || !definition.reference) return null;
    return 100 * (definition.direction === "lower" ? definition.reference / measured : measured / definition.reference);
  }

  function format(key, value) {
    const definition = get(key);
    const measured = Number(value);
    return definition && Number.isFinite(measured) ? definition.format(measured) : "—";
  }

  window.PoseTekBenchmarks = Object.freeze({
    generation: 2,
    profile: "senior|unspecified",
    metrics,
    get,
    score,
    format
  });
})();
