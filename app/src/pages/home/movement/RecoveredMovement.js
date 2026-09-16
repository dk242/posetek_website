import { recordingBounds, fitRecording } from "./framing";
// Recovered from the accepted 2026-09-15 deployment; see PROVENANCE.md.
// Recorded data and playback logic are preserved; rendering refinements are documented.
// Shared React is imported from npm.
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { TacticalIcon as TacticalIcon } from '../TacticalIcon';
import recordedMovement from './recorded-movement.json';
function measurementForFrame(e, t, n = e.fps ?? 60) {
    if (e.verticalJump) {
        let n = e.verticalJump.heightMeters[t];
        return { label: `COM rise`, value: Number.isFinite(n) && n >= 0 ? (n / .0254).toFixed(1) : `—`, unit: `in`, caption: `Calibrated height` };
    }
    let r = e.telemetry?.speed;
    if (!r) {
        let e = t / n;
        return { label: `Rep time`, value: Number.isFinite(e) && e >= 0 ? e.toFixed(2) : `—`, unit: `s`, caption: `Recorded playback` };
    }
    let i = r?.metersPerSecond[t], a = typeof i == `number` && Number.isFinite(i) && i >= 0;
    return { label: `${r?.subject === `ball` || e.key === `shooting` ? `Ball` : `Player`} speed`, value: a ? (i / .44704).toFixed(1) : `—`, unit: `mph`, caption: a ? r?.source === `model` ? `Model estimate · this frame` : `Measured · this frame` : `Not available at this frame` };
}
function projectCalibrationPoint(e, t, n) {
    if (e.length !== 9 || !e.every(Number.isFinite))
        return null;
    let r = e[6] * t + e[7] * n + e[8];
    return !Number.isFinite(r) || Math.abs(r) < 1e-8 ? null : [(e[0] * t + e[1] * n + e[2]) / r, (e[3] * t + e[4] * n + e[5]) / r];
}
function calibrationGridLines(e) {
    if (!e)
        return [];
    let { homography: t, xRange: n, yRange: r, stepMeters: i } = e;
    if (n.length !== 2 || r.length !== 2 || ![...n, ...r, i].every(Number.isFinite) || i <= 0 || n[1] <= n[0] || r[1] <= r[0])
        return [];
    let a = Math.floor((n[1] - n[0]) / i), s = Math.floor((r[1] - r[0]) / i);
    if (a + s > 200)
        return [];
    let c = [], l = (e, n, r, i) => { let a = projectCalibrationPoint(t, e, n), s = projectCalibrationPoint(t, r, i); a && s && c.push([a, s]); };
    for (let e = 0; e <= a; e++)
        l(n[0] + e * i, r[0], n[0] + e * i, r[1]);
    for (let e = 0; e <= s; e++)
        l(n[0], r[0] + e * i, n[1], r[0] + e * i);
    return c;
}
var DEFAULT_VIEWPORT = { width: 1, height: 1, ratio: 1, scale: 1, offsetX: 0, offsetY: 0 }, BODY_EDGES = [[11, 12], [12, 24], [24, 23], [23, 11], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [23, 25], [25, 27], [27, 29], [27, 31], [29, 31], [24, 26], [26, 28], [28, 30], [28, 32], [30, 32]];
function isPoseData(e) {
    if (!e || typeof e != `object`)
        return !1;
    let t = e;
    return t.layout === `mediapipe33` && Array.isArray(t.sequences);
}
function formatTime(e) { let t = Math.max(0, Number(e) || 0), n = Math.floor(t / 60); return `${n}:${(t - n * 60).toFixed(2).padStart(5, `0`)}`; }
function fitViewport(e, t, n, r) { let i = Math.min(2, n || 1), a = Math.max(1, e), o = Math.max(1, t), s = Math.min(a / r, o); return { width: a, height: o, ratio: i, scale: s, offsetX: (a - r * s) / 2, offsetY: (o - s) / 2 }; }
function canvasSize(e) { return { width: Math.round(e.width * e.ratio), height: Math.round(e.height * e.ratio) }; }
function screenPoint(e, t, n) {
    if (!e || !Number.isFinite(e[0]) || !Number.isFinite(e[1]))
        return null;
    let r = t.scale, i = n * t.scale;
    return { x: t.offsetX + e[0] * i, y: t.offsetY + e[1] * r };
}
function landmark(e, t) { let n = e?.[t]; return Array.isArray(n) ? n : null; }
function hipCenter(e) { let t = landmark(e, 23), n = landmark(e, 24); return !t || !n ? null : [(t[0] + n[0]) / 2, (t[1] + n[1]) / 2]; }
function markerFrame(e, t) { return e.markers[t] ?? NaN; }
function directionPhase(e, t) { return t <= markerFrame(e, `startEnd`) ? { title: `Start`, color: `#66c2ff` } : t <= markerFrame(e, `turnEnd`) ? { title: `Turn`, color: `#ffc969` } : { title: `End`, color: `#71d39b` }; }
function jumpPhase(e, t) { return t < markerFrame(e, `takeoff`) ? { title: `Load`, color: `#66c2ff` } : t <= markerFrame(e, `landing`) ? { title: `Flight`, color: `#b7f34a` } : { title: `Landing`, color: `#ffc969` }; }
function phaseForFrame(e, t) {
    if (e.phases?.length) {
        let n = [...e.phases].reverse().find(e => e.from <= t) || e.phases[0];
        return { title: n.title, color: n.color };
    }
    return e.key === `broadJump` ? jumpPhase(e, t) : e.key === `changeOfDirection` ? directionPhase(e, t) : { title: `Recorded movement`, color: `#b7f34a` };
}
function directionSegments(e) { let t = markerFrame(e, `startEnd`), n = markerFrame(e, `turnEnd`); return [{ start: 0, end: t, color: `#66c2ff` }, { start: t + 1, end: n, color: `#ffc969` }, { start: n + 1, end: markerFrame(e, `end`), color: `#71d39b` }]; }
function trailWindow(e) { return { start: Math.max(0, e - 24), end: e + 1 }; }
function overlayLabelY(e, t) { return Math.max(e + 22, t - 17); }
function lastFrame(e) { return e.frames.length - 1; }
function secondsAtFrame(e, t) { return e / t; }
function durationSeconds(e, t) { return Math.max(0, lastFrame(e) / t); }
function timerText(e, t, n) { return `${formatTime(secondsAtFrame(e, n))} / ${formatTime(durationSeconds(t, n))}`; }
function phaseLabel(e, t) { return `${e.title} · ${t.toFixed(2)} s`; }
function scrubberLabel(e, t) { return `${e.title}, ${t.toFixed(2)} seconds`; }
function wrapIndex(e, t) { return (e + t) % t; }
function restingFrame(e, t, n) {
    if (!t || n)
        return 0;
    if (e.previewFrame !== void 0)
        return clampFrame(e.previewFrame, lastFrame(e));
    let r = markerFrame(e, e.key === `broadJump` ? `takeoff` : `turn`);
    return Number.isFinite(r) ? r : Math.floor(Math.max(0, lastFrame(e)) / 2);
}
function clampFrame(e, t) { return Math.max(0, Math.min(t, Number(e) || 0)); }
function elapsedTime(e, t) { return Math.min(100, e - t); }
function advanceFrame(e, t, n, r, i) { let a = t + n * r / 1e3, o = Math.floor(a); return o <= 0 ? { accumulator: a, frame: e, advanced: !1 } : { accumulator: a - o, frame: Math.min(i, e + o), advanced: !0 }; }
function createMovementController(e, t, n, r = !0) {
    if (!isPoseData(e))
        return null;
    let { canvas: i, playButton: o, playIcon: d, scrubber: _, timer: y, phaseChip: T, telemetryPhase: k } = t, A = i.getContext(`2d`);
    if (!A)
        return null;
    let j = A, M = window.matchMedia(`(prefers-reduced-motion: reduce)`), N = { sequenceIndex: 0, frame: 0, playing: !1, visible: !1, active: r, userPaused: M.matches, lastTimestamp: 0, accumulator: 0, endHold: 0, animationId: 0, viewport: { ...DEFAULT_VIEWPORT } }, P = () => e.sequences[N.sequenceIndex], F = () => P().fps ?? e.fps, I = () => P().sourceAspectRatio ?? e.sourceAspectRatio, L = e => screenPoint(e, N.viewport, I());
    function R(e, t, n, r) {
        j.save(), r && j.setLineDash(r), j.strokeStyle = t, j.lineWidth = n, j.lineCap = `round`, j.lineJoin = `round`, j.beginPath();
        let i = !1;
        e.forEach(e => {
            let t = L(e);
            if (!t) {
                i = !1;
                return;
            }
            i ? j.lineTo(t.x, t.y) : j.moveTo(t.x, t.y), i = !0;
        }), j.stroke(), j.restore();
    }
    function z(e, t, n) {
        j.save();
        for (let r = 1; r < e.length; r++)
            !e[r - 1] || !e[r] || (j.globalAlpha = .12 + .88 * r / Math.max(1, e.length - 1), R([e[r - 1], e[r]], t, n));
        j.restore();
    }
    function B(e) {
        let t = e.calibration;
        if (!t)
            return;
        calibrationGridLines(t.grid).forEach(e => R(e, `#9bd5a12e`, 1));
        let n = t.baseline;
        if (n && Number.isFinite(n.distanceMeters) && n.distanceMeters > 0) {
            let e = L(n.start), t = L(n.end);
            e && t && (R([n.start, n.end], `#b7f34a55`, 1, [3, 4]), j.save(), j.fillStyle = `#a4bd99`, j.font = `500 8px 'IBM Plex Mono', monospace`, j.textAlign = `center`, j.fillText(`${(n.distanceMeters / .3048).toFixed(1)} ft`, (e.x + t.x) / 2, (e.y + t.y) / 2 + 12), j.restore());
        }
        t.markers.forEach(e => {
            if (e.corners.length !== 4 || !e.corners.every(e => e.length >= 2 && e.every(Number.isFinite)))
                return;
            let t = e.corners.map(L);
            if (t.some(e => !e))
                return;
            let n = t[0];
            j.save(), j.beginPath(), j.moveTo(n.x, n.y), t.slice(1).forEach(e => j.lineTo(e.x, e.y)), j.closePath(), j.fillStyle = `#061810bf`, j.fill(), j.strokeStyle = `#b7f34a`, j.lineWidth = 1.25, j.stroke(), t.forEach(e => { j.fillStyle = `#d9f5be`, j.fillRect(e.x - 1.5, e.y - 1.5, 3, 3); }), j.font = `500 8px 'IBM Plex Mono', monospace`, j.fillStyle = `#b7f34a`, j.fillText(`A${e.id}`, n.x, n.y - 5), j.restore();
        });
    }
    function V(e) {
        let t = e.overlays;
        if (!t)
            return;
        let n = L([0, t.groundY]), r = L([1, t.groundY]);
        if (!n || !r)
            return;
        j.save(), j.strokeStyle = `rgba(0,0,0,.75)`, j.lineWidth = 2, j.beginPath(), j.moveTo(n.x, n.y), j.lineTo(r.x, r.y), j.stroke(), j.restore(), [[t.takeoffX, `#71d39b`], [t.landingX, `#ff7d7d`]].forEach(([e, t]) => { let n = L([e, 1]); R([[e, 0], [e, 1]], t, 2, [7, 5]), n && (j.save(), j.fillStyle = t, j.beginPath(), j.arc(n.x, n.y, 3, 0, Math.PI * 2), j.fill(), j.restore()); });
        let i = trailWindow(N.frame);
        z(t.com.slice(i.start, i.end), `#66d6e8`, 2), z(t.foot.slice(i.start, i.end), `#ffad5c`, 2), [[t.com[N.frame], `#66d6e8`, 4], [t.foot[N.frame], `#ffad5c`, 3.5]].forEach(([e, t, n]) => { let r = L(e); r && (j.fillStyle = t, j.beginPath(), j.arc(r.x, r.y, n, 0, Math.PI * 2), j.fill()); });
        let a = L([t.takeoffX, t.groundY]), o = L([t.landingX, t.groundY]);
        if (!a || !o)
            return;
        let s = e.metrics[0][1], c = (a.x + o.x) / 2, l = overlayLabelY(N.viewport.offsetY, a.y);
        j.save(), j.fillStyle = `rgba(0,0,0,.72)`, j.fillRect(c - 33, l - 14, 66, 22), j.fillStyle = `#f7fbf9`, j.font = `700 11px 'IBM Plex Mono', monospace`, j.textAlign = `center`, j.fillText(s, c, l + 1), j.restore();
    }
    function H(e) {
        let t = e.verticalJump;
        if (!t)
            return;
        let n = t.com[N.frame], r = L(n);
        if (!n || !r)
            return;
        let i = L([n[0], t.baselineY]);
        R([[.12, t.groundY], [.88, t.groundY]], `#71d39b66`, 1), R([[.35, t.baselineY], [.72, t.baselineY]], `#66d6e855`, 1, [4, 4]);
        let o = trailWindow(N.frame);
        z(t.com.slice(o.start, o.end), `#66d6e8`, 2), j.save(), j.strokeStyle = `#66d6e8`, j.fillStyle = `#66d6e8`, j.lineWidth = 1.5, j.beginPath(), j.arc(r.x, r.y, 4, 0, Math.PI * 2), j.fill();
        let s = r.x + 20;
        j.beginPath(), j.moveTo(s, i.y), j.lineTo(s, r.y), j.moveTo(s - 4, i.y), j.lineTo(s + 4, i.y), j.moveTo(s - 4, r.y), j.lineTo(s + 4, r.y), j.stroke();
        let c = `COM rise ${measurementForFrame(e, N.frame, F()).value} in`, l = `Peak ${(t.peakMeters / .0254).toFixed(1)} in`;
        j.font = `600 10px 'IBM Plex Mono', monospace`;
        let u = Math.max(j.measureText(c).width, j.measureText(l).width) + 16, d = Math.max(8, Math.min(s + 10, N.viewport.width - u - 8)), f = Math.max(40, Math.min(r.y - 14, N.viewport.height - 72));
        j.fillStyle = `#071b16ee`, j.fillRect(d, f - 15, u, 38), j.fillStyle = `#bdeff0`, j.fillText(c, d + 8, f), j.fillStyle = `#b7f34a`, j.fillText(l, d + 8, f + 15), j.restore();
    }
    function oe(e) {
        directionSegments(e).forEach(t => {
            let n = Math.min(N.frame, t.end);
            if (n < t.start)
                return;
            let r = [];
            for (let i = Math.max(t.start, N.frame - 48); i <= n; i += 1)
                r.push(hipCenter(e.frames[i]));
            z(r, t.color, 2.5);
        });
        let t = L(hipCenter(e.frames[N.frame]));
        if (!t)
            return;
        let n = directionPhase(e, N.frame);
        j.fillStyle = n.color, j.beginPath(), j.arc(t.x, t.y, 4.5, 0, Math.PI * 2), j.fill(), j.strokeStyle = `#fff`, j.lineWidth = 1, j.stroke();
    }
    function se(frame) {
        // Style the supplied landmarks only: no interpolation or inferred trajectory.
        const points = frame.map(L);
        const isDetail = index => index >= 17 && index <= 22 || index >= 29;
        j.save();
        j.lineCap = `round`;
        j.lineJoin = `round`;

        for (const detail of [false, true]) {
            j.beginPath();
            BODY_EDGES.forEach(([from, to]) => {
                if ((isDetail(from) || isDetail(to)) !== detail) return;
                const start = points[from], end = points[to];
                if (!start || !end) return;
                j.moveTo(start.x, start.y);
                j.lineTo(end.x, end.y);
            });
            j.strokeStyle = detail ? `#aacbbb` : `#edf6e8`;
            j.lineWidth = detail ? 1 : 1.5;
            j.stroke();
        }

        points.forEach((point, index) => {
            if (!point) return;
            // Retain nose/ear orientation; de-emphasize dense facial micro-landmarks.
            if (index < 11 && ![0, 7, 8].includes(index)) return;
            const major = index >= 11 && !isDetail(index);
            j.beginPath();
            j.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
            j.fillStyle = major ? `#b7f34a` : index < 11 ? `#aacbbb` : `#dcebdc`;
            j.fill();
        });
        j.restore();
    }
    function ce(e) { let n = secondsAtFrame(N.frame, F()), r = phaseForFrame(e, N.frame); y.textContent = timerText(N.frame, e, F()), T.textContent = phaseLabel(r, n), T.style.setProperty(`--phase-color`, r.color), k && k.textContent !== r.title && (k.textContent = r.title); let i = measurementForFrame(e, N.frame, F()); t.measurementLabel && (t.measurementLabel.textContent = i.label), t.measurementValue && (t.measurementValue.textContent = i.value), t.measurementUnit && (t.measurementUnit.textContent = i.unit), t.measurementCaption && (t.measurementCaption.textContent = i.caption), _.value = String(N.frame), _.style.setProperty(`--pose-progress`, `${100 * N.frame / Math.max(1, lastFrame(e))}%`), _.setAttribute(`aria-valuetext`, scrubberLabel(r, n)); }
    function U() {
        let e = P(), t = e.frames[N.frame] || e.frames[0], n = N.viewport;
        if (j.setTransform(n.ratio, 0, 0, n.ratio, 0, 0), j.clearRect(0, 0, n.width, n.height), j.save(), j.beginPath(), j.rect(0, 0, n.width, n.height), j.clip(), B(e), e.key === `broadJump` ? V(e) : e.key === `changeOfDirection` && oe(e), se(t), e.verticalJump && H(e), e.ball) {
            let t = trailWindow(N.frame);
            z(e.ball.slice(t.start, t.end).map(e => e ? [e.x, e.y] : null), `#ffc969`, 1.5);
        }
        let r = e.ball?.[N.frame];
        if (r) {
            let e = L([r.x, r.y]);
            e && (j.beginPath(), j.arc(e.x, e.y, Math.max(3, r.radius * n.scale), 0, Math.PI * 2), j.fillStyle = `#b7f34a22`, j.fill(), j.strokeStyle = `#ffc969`, j.lineWidth = 1.5, j.stroke());
        }
        j.restore(), ce(e);
    }
    function W() { let e = i.getBoundingClientRect(); N.viewport = fitRecording(e.width, e.height, window.devicePixelRatio, recordingBounds(P(), I())); let t = canvasSize(N.viewport); (i.width !== t.width || i.height !== t.height) && (i.width = t.width, i.height = t.height), U(); }
    function G() { d.dataset.playing = String(N.playing), o.setAttribute(`aria-label`, N.playing ? `Pause pose playback` : `Play pose playback`), o.setAttribute(`aria-pressed`, String(N.playing)); }
    function K() { N.animationId && cancelAnimationFrame(N.animationId), N.animationId = 0, N.playing = !1, N.lastTimestamp = 0, G(); }
    function q() { !N.animationId && N.playing && N.visible && N.active && !document.hidden && (N.animationId = requestAnimationFrame(le)); }
    function J() { !N.visible || !N.active || document.hidden || (N.playing = !0, N.lastTimestamp = 0, G(), q()); }
    function Y(r, a, o = 1) { let s = wrapIndex(r, e.sequences.length); s !== N.sequenceIndex && !M.matches && (i.getAnimations?.().forEach(e => e.cancel()), i.animate?.([{ opacity: .1, transform: `translateX(${o * 28}px)`, filter: `blur(3px)` }, { opacity: 1, transform: `translateX(0)`, filter: `blur(0)` }], { duration: 380, easing: `cubic-bezier(.16,1,.3,1)` }), t.scan?.getAnimations?.().forEach(e => e.cancel()), t.scan?.animate?.([{ transform: `translateX(${o * -100}%)`, opacity: 0 }, { opacity: .7, offset: .25 }, { transform: `translateX(${o * 100}%)`, opacity: 0 }], { duration: 560, easing: `cubic-bezier(.16,1,.3,1)` })), N.sequenceIndex = s, N.accumulator = 0, N.endHold = 0; let c = P(); N.frame = restingFrame(c, M.matches, a), _.max = String(lastFrame(c)), n(N.sequenceIndex), W(), a && J(); }
    function le(t) {
        if (N.animationId = 0, !N.playing || !N.visible || !N.active || document.hidden)
            return;
        N.lastTimestamp ||= t;
        let n = elapsedTime(t, N.lastTimestamp);
        N.lastTimestamp = t;
        let r = P();
        if (N.frame >= lastFrame(r))
            N.endHold += n, N.endHold >= 650 && Y(N.sequenceIndex + (e.autoAdvance === !1 ? 0 : 1), !1);
        else {
            let e = advanceFrame(N.frame, N.accumulator, n, F(), lastFrame(r));
            N.accumulator = e.accumulator, e.advanced && (N.frame = e.frame, U());
        }
        q();
    }
    let X = new IntersectionObserver(e => {
        if (N.visible = !!e[0]?.isIntersecting, !N.visible) {
            K();
            return;
        }
        N.userPaused || J();
    }, { threshold: .2 });
    X.observe(i);
    let Z = () => { document.hidden ? K() : N.userPaused || J(); };
    document.addEventListener(`visibilitychange`, Z);
    let Q = e => { e.matches && (N.userPaused = !0, K()); };
    M.addEventListener?.(`change`, Q);
    let $ = new ResizeObserver(() => W());
    return $.observe(i), Y(0, !1), W(), { togglePlay() {
            if (N.playing) {
                N.userPaused = !0, K();
                return;
            }
            N.frame >= lastFrame(P()) && (N.frame = 0), N.userPaused = !1, N.endHold = 0, U(), J();
        }, scrub(e) { N.userPaused = !0, K(), N.frame = clampFrame(e, lastFrame(P())), U(); }, selectDrill(t) { let n = e.sequences.findIndex(e => e.key === t); n < 0 || (K(), N.userPaused = M.matches, Y(n, !N.userPaused, n < N.sequenceIndex ? -1 : 1)); }, stepSequence(e) { K(), Y(N.sequenceIndex + e, !N.userPaused, e); }, setActive(e) { N.active = e, e ? (W(), N.userPaused || J()) : K(); }, destroy() { N.animationId && cancelAnimationFrame(N.animationId), N.animationId = 0, N.playing = !1, X.disconnect(), $.disconnect(), document.removeEventListener(`visibilitychange`, Z), M.removeEventListener?.(`change`, Q); } };
}
function useMovementPlayback(e, t, n = !0) {
    let { canvas: r, playButton: a, playIcon: o, scrubber: s, timer: c, phaseChip: l, telemetryPhase: u, measurementLabel: d, measurementValue: f, measurementUnit: p, measurementCaption: m, scan: h } = t, g = (0, React.useRef)(null), _ = (0, React.useRef)(n), [v, y] = (0, React.useState)(0);
    return (0, React.useEffect)(() => {
        let t = r.current, n = a.current, i = o.current, v = s.current, b = c.current, x = l.current;
        if (!t || !n || !i || !v || !b || !x)
            return;
        let S = createMovementController(e, { canvas: t, playButton: n, playIcon: i, scrubber: v, timer: b, phaseChip: x, telemetryPhase: u.current, measurementLabel: d?.current, measurementValue: f?.current, measurementUnit: p?.current, measurementCaption: m?.current, scan: h?.current }, y, _.current);
        if (S)
            return g.current = S, () => { S.destroy(), g.current = null; };
    }, [e, r, a, o, s, c, l, u, d, f, p, m, h]), (0, React.useEffect)(() => { _.current = n, g.current?.setActive(n); }, [n]), { sequenceIndex: v, togglePlay: () => g.current?.togglePlay(), scrub: e => g.current?.scrub(e.currentTarget.value), selectDrill: e => g.current?.selectDrill(e), stepSequence: e => g.current?.stepSequence(e) };
}
const movementData = recordedMovement, initialSequence = movementData.sequences[0], initialPhase = phaseForFrame(initialSequence, 0), initialFps = initialSequence.fps ?? movementData.fps, initialTimer = timerText(0, initialSequence, initialFps), initialPhaseLabel = phaseLabel(initialPhase, secondsAtFrame(0, initialFps)), initialMeasurement = measurementForFrame(initialSequence, 0, initialFps), drillLabels = { sprint: `Sprint`, jump: `Vertical jump`, broadJump: `Broad jump`, dribbling: `Dribbling`, changeOfDirection: `Agility`, shooting: `Shooting` }, drillOptions = movementData.sequences.map((e, t) => ({ key: e.key, number: String(t + 1).padStart(2, `0`), label: drillLabels[e.key] || e.title }));
function PoseDemo({ requestedDrill: e, active: t = !0, onDrillChange, hideChoices = false }) { let r = (0, React.useRef)(null), a = (0, React.useRef)(null), o = (0, React.useRef)(null), s = (0, React.useRef)(null), c = (0, React.useRef)(null), l = (0, React.useRef)(null), u = (0, React.useRef)(null), d = (0, React.useRef)(null), f = (0, React.useRef)(null), p = (0, React.useRef)(null), m = (0, React.useRef)(null), h = (0, React.useRef)(null), { sequenceIndex: g, togglePlay: _, scrub: v, selectDrill: y, stepSequence: b } = useMovementPlayback(movementData, { canvas: r, playButton: a, playIcon: o, scrubber: s, timer: c, phaseChip: l, telemetryPhase: u, measurementLabel: d, measurementValue: f, measurementUnit: p, measurementCaption: m, scan: h }, t), x = movementData.sequences[g], S = (0, React.useRef)(y); return (0, React.useEffect)(() => { onDrillChange?.(x.key); }, [x.key, onDrillChange]), (0, React.useEffect)(() => { S.current = y; }, [y]), (0, React.useEffect)(() => { e && S.current(e.key); }, [e]), (0, jsxRuntime.jsx)(`div`, { className: `performance-stage movement-demo`, role: `region`, "aria-roledescription": `carousel`, "aria-label": `PoseTek recorded movement analysis`, children: (0, jsxRuntime.jsxs)(`div`, { className: `session-mock`, children: [(0, jsxRuntime.jsxs)(`div`, { className: `session-head`, children: [(0, jsxRuntime.jsxs)(`span`, { className: `movement-signal`, "aria-hidden": `true`, children: [(0, jsxRuntime.jsx)(`i`, {}), (0, jsxRuntime.jsx)(`i`, {}), (0, jsxRuntime.jsx)(`i`, {})] }), (0, jsxRuntime.jsxs)(`span`, { children: [(0, jsxRuntime.jsx)(`strong`, { id: `poseDrillTitle`, children: x.title }), (0, jsxRuntime.jsx)(`small`, { children: `Recorded movement · real rep` })] }), (0, jsxRuntime.jsxs)(`div`, { className: `pose-carousel-nav`, "aria-label": `Recording carousel controls`, children: [(0, jsxRuntime.jsx)(`button`, { type: `button`, onClick: () => b(-1), "aria-label": `Previous recording`, children: (0, jsxRuntime.jsx)(TacticalIcon, { kind: `previous` }) }), (0, jsxRuntime.jsxs)(`span`, { className: `pose-carousel-count`, "aria-label": `Recording ${g + 1} of ${movementData.sequences.length}`, children: [String(g + 1).padStart(2, `0`), ` `, (0, jsxRuntime.jsx)(`span`, { children: `/ 06` })] }), (0, jsxRuntime.jsx)(`button`, { type: `button`, onClick: () => b(1), "aria-label": `Next recording`, children: (0, jsxRuntime.jsx)(TacticalIcon, { kind: `next` }) })] })] }), (0, jsxRuntime.jsx)(`div`, { className: `pose-drill-switcher`, hidden: hideChoices, role: `group`, "aria-label": `Choose a recorded pose demo`, children: drillOptions.map(e => (0, jsxRuntime.jsxs)(`button`, { className: x.key === e.key ? `active` : ``, type: `button`, "data-pose-drill": e.key, "aria-pressed": x.key === e.key, onClick: () => y(e.key), children: [(0, jsxRuntime.jsx)(`span`, { children: e.number }), (0, jsxRuntime.jsx)(`strong`, { children: e.label }), (0, jsxRuntime.jsx)(`i`, { "aria-hidden": `true` })] }, e.key)) }), (0, jsxRuntime.jsxs)(`div`, { className: `movement-viewer`, children: [(0, jsxRuntime.jsxs)(`div`, { className: `session-video`, children: [(0, jsxRuntime.jsx)(`div`, { className: `movement-ambient-grid`, "aria-hidden": `true` }), (0, jsxRuntime.jsx)(`canvas`, { id: `landingPoseCanvas`, ref: r, role: `img`, "aria-label": `${x.title}: recorded pose with synchronized analysis overlays` }), (0, jsxRuntime.jsx)(`span`, { className: `movement-scan`, ref: h, "aria-hidden": `true` }), (0, jsxRuntime.jsxs)(`span`, { className: `video-chip`, children: [`POSE / `, String(g + 1).padStart(2, `0`)] }), x.calibration?.markers.length ? (0, jsxRuntime.jsx)(`span`, { className: `movement-calibration`, children: `ArUco calibration` }) : null, (0, jsxRuntime.jsx)(`span`, { className: `pose-phase`, id: `posePhaseChip`, ref: l, children: initialPhaseLabel })] }), (0, jsxRuntime.jsxs)(`div`, { className: `pose-controls`, children: [(0, jsxRuntime.jsx)(`button`, { className: `pose-play`, id: `posePlayButton`, ref: a, type: `button`, "aria-label": `Play pose playback`, "aria-pressed": !1, onClick: _, children: (0, jsxRuntime.jsxs)(`span`, { id: `posePlayIcon`, ref: o, "data-playing": `false`, "aria-hidden": `true`, children: [(0, jsxRuntime.jsx)(TacticalIcon, { kind: `play` }), (0, jsxRuntime.jsx)(TacticalIcon, { kind: `pause` })] }) }), (0, jsxRuntime.jsx)(`input`, { className: `pose-scrubber`, id: `poseScrubber`, ref: s, type: `range`, min: `0`, max: lastFrame(x), defaultValue: `0`, step: `1`, "aria-label": `Pose playback position`, onInput: v }), (0, jsxRuntime.jsx)(`small`, { className: `pose-time`, id: `poseTimer`, ref: c, children: initialTimer })] })] }), (0, jsxRuntime.jsxs)(`div`, { className: `movement-summary`, children: [(0, jsxRuntime.jsxs)(`div`, { className: `movement-live-metric`, children: [(0, jsxRuntime.jsx)(`span`, { ref: d, children: initialMeasurement.label }), (0, jsxRuntime.jsxs)(`div`, { children: [(0, jsxRuntime.jsx)(`strong`, { ref: f, children: initialMeasurement.value }), (0, jsxRuntime.jsx)(`small`, { ref: p, children: initialMeasurement.unit })] }), (0, jsxRuntime.jsx)(`small`, { ref: m, children: initialMeasurement.caption })] }), (0, jsxRuntime.jsx)(`div`, { className: `session-metrics`, id: `poseMetricGrid`, style: { gridTemplateColumns: `repeat(${Math.max(1, x.metrics.length)}, minmax(0, 1fr))` }, children: x.metrics.map(([e, t]) => (0, jsxRuntime.jsxs)(`article`, { children: [(0, jsxRuntime.jsx)(`span`, { children: e }), (0, jsxRuntime.jsx)(`strong`, { children: t })] }, e)) })] })] }) }); }
export { PoseDemo as PoseDemo };

export { createMovementController, measurementForFrame, calibrationGridLines };
