/** Recovered from deployment 6aa9b6f0d8faf6177db8fd97. See PROVENANCE.md. */
import * as React from "react";
import { TacticalIcon } from "../TacticalIcon";
import { POSE_EDGES } from "../pitch/pose-model";
import { techniqueData, alignReference, projectRecordedFrames, nearestPhase, metricForJoint, formatMeasurement } from "./technique-model";
import "./technique.css";
import { walkthroughSteps, initialWalkthrough, nextWalkthrough } from "./walkthrough";

const contact = techniqueData.phases.find(phase => phase.key === 'contact');
const alignedReferences = Object.fromEntries(techniqueData.phases.filter(phase => phase.referencePose).map(phase => [phase.key, alignReference(phase.referencePose, techniqueData.frames[contact.index], contact.referencePose)]));
var projection = projectRecordedFrames([...techniqueData.frames, ...Object.values(alignedReferences)]);
var lastFrame = techniqueData.frames.length - 1;
var initialPhase = techniqueData.phases.find(e => e.key === `contact`) ?? techniqueData.phases[0];
var initialMetric = techniqueData.focusAreas[0]?.metricIds.map(e => initialPhase.metrics.find(t => t.id === e)).find(Boolean) ?? initialPhase.metrics[0];
var jointNames = `nose.left inner eye.left eye.left outer eye.right inner eye.right eye.right outer eye.left ear.right ear.left mouth.right mouth.left shoulder.right shoulder.left elbow.right elbow.left wrist.right wrist.left pinky.right pinky.left index finger.right index finger.left thumb.right thumb.left hip.right hip.left knee.right knee.left ankle.right ankle.left heel.right heel.left foot tip.right foot tip`.split(`.`);
function PoseSkeleton({ points, highlighted, projection, onJoint, phase, selectedId }) {
  return <>
    <g className={`technique-bones`}>
      {POSE_EDGES.map(([r, i]) => {
        if (!points[r] || !points[i])
          return null;
        let a = projection.point(points[r]);
        let o = projection.point(points[i]);
        let s = highlighted.includes(r) && highlighted.includes(i);
        return <line x1={a[0]} y1={a[1]} x2={o[0]} y2={o[1]} className={s ? `is-highlighted` : ``} key={`${r}-${i}`} />;
      })}
    </g>
    <g>
      {points.map((e, r) => {
        let [s, c] = projection.point(e);
        let u = highlighted.includes(r);
        let f = phase ? metricForJoint(phase, r, selectedId) : void 0;
        return <g className={`technique-joint${u ? ` is-highlighted` : ``}${f && onJoint ? ` is-interactive` : ``}`} role={f && onJoint ? `button` : void 0} tabIndex={f && onJoint ? 0 : void 0} aria-label={f && onJoint ? `Inspect ${f.label} · ${jointNames[r]}` : void 0} onClick={f && onJoint ? () => onJoint(r) : void 0} onKeyDown={f && onJoint ? e => {
          if ((e.key === `Enter` || e.key === ` `)) {
            e.preventDefault();
            onJoint(r);
          }
        } : void 0} key={r}>
          {f && onJoint && <circle className={`technique-hit-area`} cx={s} cy={c} r={12} />}
          {u && <circle className={`technique-joint-ring`} cx={s} cy={c} r={10} />}
          <circle className={`technique-joint-dot`} cx={s} cy={c} r={u ? 4.5 : r < 11 ? 1.7 : 2.8} />
        </g>;
      })}
    </g>
  </>;
}
function TechniqueDemo({ active = true }) {
  let instanceId = React.useId();
  let rootRef = React.useRef(null);
  let [phase, setPhase] = React.useState(initialPhase);
  let [frameIndex, setFrameIndex] = React.useState(0);
  let [selectedMetricId, setSelectedMetricId] = React.useState(initialMetric?.id);
  let [focusIndex, setFocusIndex] = React.useState(null);
  let [playing, setPlaying] = React.useState(false);
  let [visible, setVisible] = React.useState(false);
  let [showReference, setShowReference] = React.useState(true);
  let [detailsOpen, setDetailsOpen] = React.useState(false);
  let [walkthrough, setWalkthrough] = React.useState(initialWalkthrough);
  let guidedStep = walkthroughSteps[walkthrough.step];
  let selectedMetric = phase.metrics.find(e => e.id === selectedMetricId) ?? phase.metrics[0];
  let focusArea = focusIndex === null ? null : techniqueData.focusAreas[focusIndex];
  let isSnapshot = !playing && frameIndex === phase.index;
  let highlightedJoints = isSnapshot ? focusArea?.joints ?? selectedMetric?.joints ?? [] : [];
  let sourceFrame = techniqueData.startFrame + frameIndex * techniqueData.step;
  let ball = techniqueData.ball[frameIndex];
  let ballPoint = ball ? projection.point([ball.x, ball.y]) : null;
  let referencePose = showReference && isSnapshot && phase.referencePose ? alignedReferences[phase.key] : null;
  let referenceProjection = referencePose ? projectRecordedFrames([referencePose]) : null;
  React.useEffect(() => {
    let e = rootRef.current;
    if (!e)
      return;
    let t = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.1
    });
    t.observe(e);
    let n = () => {
      if (document.hidden) {
        setPlaying(false);
      }
    };
    document.addEventListener(`visibilitychange`, n);
    return () => {
      t.disconnect();
      document.removeEventListener(`visibilitychange`, n);
    };
  }, []);
  // oxlint-disable-next-line react/set-state-in-effect -- Pause the preserved player when its section or viewport becomes inactive.
  React.useEffect(() => {
    if ((!active || !visible)) {
      setPlaying(false);
    }
  }, [active, visible]);
  /* oxlint-disable react-hooks/exhaustive-deps -- Capture the starting frame once per playback run; frame updates must not restart its clock. */
  React.useEffect(() => {
    if (!playing || !active || !visible)
      return;
    let t = frameIndex;
    let n;
    let r = 0;
    let i = e => {
      n ??= e;
      let target = walkthrough.status === "approaching" ? guidedStep.phase.index : lastFrame;
      let a = Math.min(target, t + Math.floor((e - n) / 1000 * techniqueData.fps / techniqueData.step * 0.25));
      if (setFrameIndex(a), a === target) {
        setPlaying(false);
        if (walkthrough.status === "approaching") {
          applyStep(guidedStep);
          setWalkthrough(current => ({ ...current, status: "paused" }));
        }
        return;
      }
      r = requestAnimationFrame(i);
    };
    r = requestAnimationFrame(i);
    return () => cancelAnimationFrame(r);
  }, [
    playing,
    active,
    visible,
    walkthrough
  ]); /* oxlint-enable react-hooks/exhaustive-deps */
  let selectPhase = e => {
    setWalkthrough(initialWalkthrough);
    setPlaying(false);
    setPhase(e);
    setFrameIndex(e.index);
    setFocusIndex(null);
    setSelectedMetricId(e.metrics[0]?.id);
    if (!e.referencePose) {
      setShowReference(false);
    }
  };
  let selectMetric = e => {
    setWalkthrough(initialWalkthrough);
    setPlaying(false);
    setFrameIndex(phase.index);
    setFocusIndex(null);
    setSelectedMetricId(e);
  };
  let selectFocusArea = e => {
    let t = techniqueData.focusAreas[e];
    let n = techniqueData.phases.find(e => e.key === t.frameKey);
    if (n) {
      selectPhase(n);
      setFocusIndex(e);
      setSelectedMetricId(t.metricIds.map(e => n.metrics.find(t => t.id === e)).find(Boolean)?.id ?? n.metrics[0]?.id);
    }
  };
  function applyStep(step) {
    setPhase(step.phase);
    setFrameIndex(step.phase.index);
    setFocusIndex(step.focusIndex);
    setSelectedMetricId(step.metricId);
    setShowReference(!!step.phase.referencePose);
  }
  function startWalkthrough() {
    setFrameIndex(0);
    setFocusIndex(null);
    setShowReference(false);
    setWalkthrough({ status: "approaching", step: 0 });
    setPlaying(true);
  }
  function continueWalkthrough() {
    const next = nextWalkthrough(walkthrough, frameIndex);
    setWalkthrough(next);
    if (next.status === "paused") applyStep(walkthroughSteps[next.step]);
    if (next.status === "approaching") { setShowReference(false); setPlaying(true); }
  }
  return <div ref={rootRef} className={`technique-demo`} data-playing={playing}>
    <div className="technique-guide">
      <div aria-live="polite"><span className="technique-mini-label">GUIDED ANALYSIS · ¼ SPEED</span><strong>{walkthrough.status === "idle" ? "See one kick, one cue at a time." : walkthrough.status === "finished" ? "Review complete. Put the cues into practice." : (walkthrough.status === "approaching" ? "Next: " : "Pause " + (walkthrough.step + 1) + " / " + walkthroughSteps.length + " · ") + guidedStep.title}</strong></div>
      {walkthrough.status === "idle" || walkthrough.status === "finished" ? <button type="button" onClick={startWalkthrough}>{walkthrough.status === "idle" ? "Start walkthrough" : "Replay walkthrough"}<TacticalIcon kind="play" /></button> : walkthrough.status === "paused" ? <button type="button" onClick={continueWalkthrough}>{walkthrough.step === walkthroughSteps.length - 1 ? "Finish review" : "Continue"}<TacticalIcon kind="next" /></button> : <button type="button" onClick={() => setPlaying(!playing)}>{playing ? "Pause walkthrough" : "Resume walkthrough"}<TacticalIcon kind={playing ? "pause" : "play"} /></button>}
    </div>
    <div className={`technique-workspace`}>
      <div className={`technique-stage-header`}>
        <span>
          <i />
          {`RECORDED KICK`}
        </span>
        <span>
          {playing ? `¼ SPEED` : isSnapshot ? phase.title.toUpperCase() : `FRAME EXPLORER`}
        </span>
      </div>
      <div className="technique-canvases">
        <svg className={`technique-stage`} viewBox={`0 0 600 340`} role={`group`} aria-label={`Recorded kick at frame ${sourceFrame}`}>
          <defs>
            <pattern id={`${instanceId}-grid`} width={`40`} height={`40`} patternUnits={`userSpaceOnUse`}>
              <path d={`M40 0H0V40`} fill={`none`} stroke={`#214438`} strokeWidth={`.5`} />
            </pattern>
            <radialGradient id={`${instanceId}-light`}>
              <stop stopColor={`#214b34`} stopOpacity={`.65`} />
              <stop offset={`1`} stopColor={`#071b13`} stopOpacity={`0`} />
            </radialGradient>
          </defs>
          <rect width={`600`} height={`340`} fill={`url(#${instanceId}-grid)`} />
          <ellipse cx={`300`} cy={`170`} rx={`240`} ry={`160`} fill={`url(#${instanceId}-light)`} />
          <path className={`technique-corners`} d={`M20 40V20H40M560 20H580V40M580 300V320H560M40 320H20V300`} />
          {referencePose && <g className="technique-ghost" aria-label="Static professional reference aligned to the player"><PoseSkeleton points={referencePose} highlighted={[]} projection={projection} /></g>}
          <PoseSkeleton points={techniqueData.frames[frameIndex]} highlighted={highlightedJoints} projection={projection} phase={isSnapshot ? phase : void 0} selectedId={selectedMetric?.id} onJoint={detailsOpen ? e => {
            let t = metricForJoint(phase, e, selectedMetricId);
            if (t) {
              selectMetric(t.id);
            }
          } : undefined} />
          {ballPoint && ball && <g className={`technique-ball`}>
            <circle cx={ballPoint[0]} cy={ballPoint[1]} r={ball.radius * projection.scale} />
            <path d={`M${ballPoint[0] - 3} ${ballPoint[1] - 3}l6 0 2 5-5 3-5-3z`} />
          </g>}
          <text x={`24`} y={`305`} className={`technique-svg-caption`}>
            {isSnapshot ? `SELECT A JOINT TO INSPECT` : `SCRUB TO EXPLORE THE MOVEMENT`}
          </text>
        </svg>
        <div className="technique-overlay-legend"><span>● Player</span>{referencePose && <span>● Pro reference · saved phase</span>}</div>
      </div>
      <div className={`technique-playback`}>
        <button type={`button`} className={`technique-play`} aria-label={playing ? `Pause technique playback` : `Play technique at quarter speed`} onClick={() => {
          setWalkthrough(initialWalkthrough);
          if (!playing && frameIndex === lastFrame) {
            setFrameIndex(0);
          }
          setShowReference(false);
          setPlaying(!playing);
        }}>
          <TacticalIcon kind={playing ? `pause` : `play`} />
        </button>
        <div className={`technique-scrubber`}>
          <input type={`range`} aria-label={`Scrub kick frame`} min={0} max={lastFrame} value={frameIndex} onChange={e => {
            setWalkthrough(initialWalkthrough);
            let t = Number(e.target.value);
            setPlaying(false);
            setShowReference(false);
            setFrameIndex(t);
            let n = nearestPhase(techniqueData.phases, t);
            if (n.key !== phase.key) {
              setPhase(n);
              setSelectedMetricId(n.metrics[0]?.id);
              setFocusIndex(null);
              if (!n.referencePose) {
                setShowReference(false);
              }
            }
          }} />
          <div className={`technique-ticks`} aria-hidden={`true`}>
            {techniqueData.phases.map(e => <span style={{
              left: `${e.index / lastFrame * 100}%`
            }} key={e.key} />)}
          </div>
        </div>
        <span className={`technique-frame`}>
          {sourceFrame}
          <small>
            {`FRAME`}
          </small>
        </span>
      </div>
      <div className={`technique-phase-tabs`} role={`group`} aria-label={`Kick analysis phases`}>
        {techniqueData.phases.map((e, t) => <button type={`button`} aria-pressed={phase.key === e.key && isSnapshot} onClick={() => selectPhase(e)} key={e.key}>
          <span>
            {`0`}
            {t + 1}
          </span>
          {e.title}
          <i />
        </button>)}
      </div>
    </div>
    <aside className="technique-inspector" aria-label="Kick measurements and coaching cues">
      <span className="technique-mini-label">{isSnapshot ? phase.title : 'Watch the movement'}</span>
      <p className="technique-cue" aria-live="polite">{isSnapshot ? (walkthrough.status === 'paused' ? guidedStep.cue : focusArea?.cue ?? 'Compare the same moment. Look for the highlighted joint.') : 'Play the walkthrough to pause at the moments that matter.'}</p>
      {isSnapshot && selectedMetric && <div className="technique-measurement" aria-live="polite"><div><small>{selectedMetric.label}</small><strong>{formatMeasurement(selectedMetric.value, selectedMetric.unit)}</strong></div>{selectedMetric.reference !== null && <div className="technique-reference-value"><small>Reference</small><strong>{formatMeasurement(selectedMetric.reference, selectedMetric.unit)}</strong></div>}</div>}
      {isSnapshot && <button type="button" className="technique-compare" disabled={!phase.referencePose} aria-pressed={showReference} onClick={() => setShowReference(!showReference)}>{phase.referencePose ? showReference ? 'Hide reference' : 'Show reference' : 'No reference saved for this phase'}</button>}
      <details className="technique-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>Explore details</summary>
        <label className="technique-measurement-select" htmlFor={instanceId + '-metric'}>Inspect a measurement<select id={instanceId + '-metric'} value={selectedMetric?.id} onChange={e => selectMetric(e.target.value)}>{phase.metrics.map(metric => <option key={metric.id} value={metric.id}>{metric.label}</option>)}</select></label>
        <div className="technique-focus-list">{techniqueData.focusAreas.map((focus,index) => <button key={focus.title} type="button" aria-pressed={focusIndex === index} onClick={() => selectFocusArea(index)}>{focus.title}</button>)}</div>
        <p className="technique-measurement-note">Select a highlighted joint to inspect its saved measurement. Measurements appear only at their recorded frame.</p>
      </details>
    </aside>
  </div>;
}
export { TechniqueDemo as default };
