// Port of legacy index.html — the 2026 "performance lab" landing page. Copy,
// markup structure, class names and ids mirror the legacy document. The inline
// <script> (sticky header state, mobile menu, sample skill map) is React state
// over home-logic.ts; landing-pose-demo.js is use-pose-demo.ts (imperative
// canvas/animation) over pose-demo.ts (pure math); landing-pose-demo-data.js is
// landing-pose-demo-data.json.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useThemeColor } from "../../lib/use-theme-color";
import { useBodyBackground } from "../../lib/use-body-background";
import { injectClarity } from "./clarity";
import { FlapText } from "./FlapText";
import {
  DEFAULT_SKILL,
  SKILL_DATA,
  SKILL_ORDER,
  isHeaderScrolled,
  menuButtonLabel,
  progressFillBackground,
  progressFillWidth,
  skillDotShadow,
  type SkillKey,
} from "./home-logic";
import {
  elapsedSeconds,
  lastFrameIndex,
  phaseChipText,
  phaseForFrame,
  telemetryFor,
  timerText,
  type PoseDemoData,
} from "./pose-demo";
import { usePoseDemo } from "./use-pose-demo";
import poseDemoData from "./landing-pose-demo-data.json";
import "./home.scss";

const POSE_DATA: PoseDemoData = poseDemoData;

// First-paint text for the nodes the demo controller drives directly (timer,
// phase chip, phase telemetry — see use-pose-demo.ts). Computed once from the
// first sequence, matching the legacy static markup, and never re-rendered so
// React does not overwrite the controller's per-frame writes.
const INITIAL_SEQUENCE = POSE_DATA.sequences[0];
const INITIAL_PHASE = phaseForFrame(INITIAL_SEQUENCE, 0);
const INITIAL_TIMER = timerText(0, INITIAL_SEQUENCE, POSE_DATA.fps);
const INITIAL_PHASE_CHIP = phaseChipText(INITIAL_PHASE, elapsedSeconds(0, POSE_DATA.fps));

// The switcher is hard-coded in the legacy markup (labels are not in the data).
const DRILL_BUTTONS = [
  { key: "changeOfDirection", number: "01", label: "Agility" },
  { key: "broadJump", number: "02", label: "Broad jump" },
];

export default function HomePage() {
  useThemeColor("#04130e"); // legacy <meta name="theme-color" content="#04130e">
  useBodyBackground("#04130e"); // legacy html { background: var(--bg) } — the overscroll canvas
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // null = untouched: the legacy initial DOM shows Agility with no inline styles
  // on the dot / progress fill until a label is clicked.
  const [activeSkill, setActiveSkill] = useState<SkillKey | null>(null);
  // One ref per legacy element id the demo script drove by getElementById.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const playIconRef = useRef<HTMLSpanElement>(null);
  const scrubberRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<HTMLElement>(null);
  const phaseChipRef = useRef<HTMLSpanElement>(null);
  const telemetryPhaseRef = useRef<HTMLElement>(null);
  const { sequenceIndex, togglePlay, scrub, selectDrill } = usePoseDemo(POSE_DATA, {
    canvas: canvasRef,
    playButton: playButtonRef,
    playIcon: playIconRef,
    scrubber: scrubberRef,
    timer: timerRef,
    phaseChip: phaseChipRef,
    telemetryPhase: telemetryPhaseRef,
  });

  const sequence = POSE_DATA.sequences[sequenceIndex];
  const telemetry = telemetryFor(sequence);
  const skillKey = activeSkill ?? DEFAULT_SKILL;
  const skill = SKILL_DATA[skillKey];
  const skillTouched = activeSkill !== null;

  // <head> parity: title, Clarity, and `html { scroll-behavior: smooth }` (auto
  // under prefers-reduced-motion) — the scrolling element can't be reached from
  // the scoped stylesheet.
  useEffect(() => {
    document.title = "PoseTek | See the Rep. Understand the Player.";
    injectClarity();
    // Full-page-load parity: the browser reset scroll (or jumped to the #hash)
    // on every legacy navigation. Done before enabling smooth scrolling so the
    // reset is instant.
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    return () => {
      root.style.scrollBehavior = previous;
    };
  }, []);

  // Legacy `updateHeader`: toggle .scrolled past 12px, on scroll and once at load.
  useEffect(() => {
    const updateHeader = () => setHeaderScrolled(isHeaderScrolled(window.scrollY));
    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);

  const toggleMenu = () => setMenuOpen(open => !open);
  const closeMenu = () => setMenuOpen(false);

  const headerClass = `site-header${headerScrolled ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`;

  return (
    <div className="pt-home">
      <header className={headerClass} id="siteHeader">
        <nav className="nav-shell" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="PoseTek home">
            <span className="brand-mark">P</span>
            <span>POSETEK</span>
          </a>
          <div className="nav-links" id="navLinks">
            <a href="#how-it-works" onClick={closeMenu}>How it works</a>
            <a href="#tests" onClick={closeMenu}>Test suite</a>
            <a href="#profile" onClick={closeMenu}>Athlete profile</a>
            <a href="#training" onClick={closeMenu}>Training</a>
          </div>
          <div className="nav-actions">
            <Link className="nav-login" to="/signin">Sign in</Link>
            <a className="nav-cta" href="bookPerformanceTest.html">Book a test <span aria-hidden="true">↗</span></a>
          </div>
          <button
            className="menu-button"
            id="menuButton"
            type="button"
            aria-label={menuButtonLabel(menuOpen)}
            aria-controls="navLinks"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            <span />
          </button>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-text reveal visible">
            <p className="eyebrow">The performance lab for developing soccer players</p>
            <h1 id="hero-title">See the rep.<br /><span>Understand the player.</span><br />Train what’s next.</h1>
            <p className="hero-copy">PoseTek turns standardized movement tests into an athlete profile coaches can explain—and a focused development plan players can act on.</p>
            <div className="hero-actions">
              <a className="button-primary" href="bookPerformanceTest.html">Book a performance test <span aria-hidden="true">→</span></a>
              <a className="button-secondary" href="#how-it-works">Explore the system <span aria-hidden="true">↓</span></a>
            </div>
            <div className="hero-proof" aria-label="PoseTek highlights">
              <span><i />Recorded rep playback</span>
              <span><i />33-joint pose tracking</span>
              <span><i />Drill-specific metrics</span>
            </div>
          </div>

          <div className="performance-stage reveal" aria-label="PoseTek performance analysis demo">
            <div className="session-mock">
              <div className="session-head"><span className="mini-mark">P</span><span><strong id="poseDrillTitle">{sequence.title}</strong><small id="poseSessionLabel">Consented adult demo · identity removed</small></span><div className="session-tabs"><span>Overview</span><span className="active">Live analysis</span><span>Profile</span></div></div>
              <div className="pose-drill-switcher" role="group" aria-label="Choose a recorded pose demo">
                {DRILL_BUTTONS.map(button => {
                  const active = sequence.key === button.key;
                  return (
                    <button
                      key={button.key}
                      className={active ? "active" : ""}
                      type="button"
                      data-pose-drill={button.key}
                      aria-pressed={active}
                      onClick={() => selectDrill(button.key)}
                    >
                      <span>{button.number}</span>{button.label}
                    </button>
                  );
                })}
              </div>
              <div className="session-video">
                <div className="field-lines" aria-hidden="true" />
                <canvas id="landingPoseCanvas" ref={canvasRef} role="img" aria-label="Recorded anonymized MediaPipe pose playback" />
                <span className="video-chip">RECORDED POSE</span>
                <span className="pose-readout" aria-live="polite"><strong id="poseSequenceLabel">{sequence.label}</strong><small>33 joints · app renderer</small></span>
                <span className="pose-phase" id="posePhaseChip" ref={phaseChipRef}>{INITIAL_PHASE_CHIP}</span>
                <div className="pose-controls">
                  <button
                    className="pose-play"
                    id="posePlayButton"
                    ref={playButtonRef}
                    type="button"
                    aria-label="Play pose playback"
                    aria-pressed={false}
                    onClick={togglePlay}
                  >
                    <span id="posePlayIcon" ref={playIconRef} aria-hidden="true">▶</span>
                  </button>
                  <input
                    className="pose-scrubber"
                    id="poseScrubber"
                    ref={scrubberRef}
                    type="range"
                    min="0"
                    max={lastFrameIndex(sequence)}
                    defaultValue="0"
                    step="1"
                    aria-label="Pose playback position"
                    onInput={scrub}
                  />
                  <small className="pose-time" id="poseTimer" ref={timerRef}>{INITIAL_TIMER}</small>
                </div>
              </div>
              <div className="session-metrics" id="poseMetricGrid">
                {sequence.metrics.map(([label, value]) => (
                  <article key={label}><span>{label}</span><strong>{value}</strong></article>
                ))}
              </div>
            </div>
            <aside className="stage-aside">
              <div className="stage-aside-head">
                <span className="stage-kicker">Analysis online</span>
                <h2>The rep becomes a readable signal.</h2>
                <p>Switch drills or scrub the timeline. PoseTek keeps the movement, phase, and outcome in one review surface.</p>
              </div>
              <div className="telemetry-board" aria-label="Live pose telemetry" aria-live="polite">
                <div className="telemetry-cell"><span>Drill</span><FlapText id="telemetryDrill" value={telemetry.drill} /></div>
                <div className="telemetry-cell"><span id="telemetryResultLabel">{telemetry.resultLabel}</span><FlapText id="telemetryResult" value={telemetry.result} /></div>
                <div className="telemetry-cell"><span>Phase</span><strong id="telemetryPhase" ref={telemetryPhaseRef}>{INITIAL_PHASE.title}</strong></div>
                <div className="telemetry-cell"><span>Tracking</span><strong>33 joints</strong></div>
              </div>
              <div className="stage-note"><strong>From movement evidence to a development decision.</strong><a href="#profile">Open the athlete profile <span aria-hidden="true">→</span></a></div>
            </aside>
          </div>
          <div className="proof-strip reveal" aria-label="PoseTek system proof points">
            <div><span>01 / Capture</span><strong>Phone-ready, repeatable test protocols</strong></div>
            <div><span>02 / Interpret</span><strong>Drill-specific phases and metrics</strong></div>
            <div><span>03 / Explain</span><strong>A profile players can understand</strong></div>
            <div><span>04 / Improve</span><strong>Training priorities with retest points</strong></div>
          </div>
        </section>

        <section className="flow-section" id="how-it-works">
          <div className="section-shell">
            <div className="section-head center reveal">
              <p className="eyebrow">One connected development loop</p>
              <h2>From first test to <span>next breakthrough.</span></h2>
              <p className="section-copy">PoseTek gives every result somewhere to go. Testing becomes understanding, understanding becomes action, and every retest makes the profile more useful.</p>
            </div>
            <div className="flow-grid">
              <article className="flow-card reveal"><span className="flow-icon">PT / 01</span><h3>Capture the athlete</h3><p>A coach runs the test suite with a phone, a repeatable setup, and the athlete’s profile selected.</p><span className="flow-link">Standardized setup <span>→</span></span></article>
              <article className="flow-card reveal"><span className="flow-icon">PT / 02</span><h3>Measure performance</h3><p>Pose tracking and drill-specific processing surface the metrics that matter for that test.</p><span className="flow-link">Rep-level analysis <span>→</span></span></article>
              <article className="flow-card reveal"><span className="flow-icon">PT / 03</span><h3>Build the profile</h3><p>Results organize into speed, power, agility, shooting, and ball-control views with video and benchmarks.</p><span className="flow-link">A profile that grows <span>→</span></span></article>
              <article className="flow-card reveal"><span className="flow-icon">PT / 04</span><h3>Train and retest</h3><p>Repeated, valid results guide priority areas and relevant progressions—then the next test closes the loop.</p><span className="flow-link">Focused development <span>→</span></span></article>
            </div>
          </div>
        </section>

        <section id="tests">
          <div className="section-shell">
            <div className="section-head reveal">
              <p className="eyebrow">The assessment suite</p>
              <h2>Six tests. One complete <span>athlete story.</span></h2>
              <p className="section-copy">Each test has its own capture protocol and its own performance language—so a sprint is measured like a sprint, and a turn is understood phase by phase.</p>
            </div>
            <div className="tests-layout">
              <div className="tests-sticky reveal">
                <h3>Measure what the athlete can do today.</h3>
                <p>PoseTek combines movement video with drill-specific metrics. Coaches can review the rep. Athletes can open their profile and understand the outcome without needing to interpret raw data.</p>
                <div className="protocol-note"><span>✓</span><span>Priorities are based on repeatable, protocol-valid results—not a label generated from one clip.</span></div>
              </div>
              <div className="test-grid">
                <article className="test-card reveal"><header><span className="test-icon speed">→</span><span className="test-number">PT 01</span></header><h3>Sprint</h3><p>Acceleration and speed across a measured lane up to 20 yards.</p><div className="metric-tags"><span>Total time</span><span>Max velocity</span><span>Acceleration</span></div></article>
                <article className="test-card reveal"><header><span className="test-icon power">↑</span><span className="test-number">PT 02</span></header><h3>Straight Vertical Jump</h3><p>Vertical output and movement positions from coil through peak height.</p><div className="metric-tags"><span>Jump height</span><span>Takeoff</span><span>Landing control</span></div></article>
                <article className="test-card reveal"><header><span className="test-icon power">↗</span><span className="test-number">PT 03</span></header><h3>Standing Broad Jump</h3><p>Horizontal power from a two-foot takeoff through a controlled landing.</p><div className="metric-tags"><span>Distance</span><span>Flight height</span><span>Landing</span></div></article>
                <article className="test-card reveal"><header><span className="test-icon control">∞</span><span className="test-number">PT 04</span></header><h3>Dribbling Shuttle</h3><p>An out-turn-return view of ball control and dribbling efficiency.</p><div className="metric-tags"><span>Total time</span><span>Phase splits</span><span>Ball distance</span></div></article>
                <article className="test-card reveal"><header><span className="test-icon agility">↔</span><span className="test-number">PT 05</span></header><h3>Change of Direction</h3><p>Planned agility separated into start, turn, and return phases.</p><div className="metric-tags"><span>Total time</span><span>Turn split</span><span>Phase %</span></div></article>
                <article className="test-card reveal"><header><span className="test-icon shooting">●</span><span className="test-number">PT 06</span></header><h3>Side-View Shooting</h3><p>Ball speed and mechanics around the plant, contact, and strike path.</p><div className="metric-tags"><span>Velocity</span><span>Launch angle</span><span>Strike mechanics</span></div></article>
              </div>
            </div>
          </div>
        </section>

        <section className="profile-section" id="profile">
          <div className="section-shell profile-layout">
            <div className="profile-copy reveal">
              <p className="eyebrow">The athlete profile</p>
              <h2>Every result has a place to <span>live.</span></h2>
              <p className="section-copy">The athlete sees a clear skill map first, then can move from the big picture into each drill, each session, and each rep.</p>
              <div className="profile-points">
                <div className="profile-point"><span>1</span><div><strong>One home for performance</strong><small>Skill breakdowns and athlete information stay together in a profile that updates over time.</small></div></div>
                <div className="profile-point"><span>2</span><div><strong>Context, not just numbers</strong><small>Benchmark comparisons help show where a result sits, while drill pages preserve the details behind it.</small></div></div>
                <div className="profile-point"><span>3</span><div><strong>Review every rep</strong><small>Video, pose overlays, key frames, and drill-specific metrics make feedback easier to understand.</small></div></div>
              </div>
            </div>
            <div className="profile-demo reveal" aria-label="Sample PoseTek athlete profile">
              <div className="demo-window">
                <div className="demo-topbar"><span className="mini-mark">P</span>Athlete home<span className="live-chip">Profile updated</span></div>
                <div className="demo-content">
                  <div className="athlete-row"><span className="avatar">AJ</span><span><strong>Alex Johnson</strong><small>Midfielder · U17 · Sample profile</small></span><span className="sample-chip">Latest test</span></div>
                  <div className="demo-main">
                    <div className="radar-card">
                      <span className="card-kicker">Skill map</span>
                      <div className="radar-wrap">
                        <svg viewBox="0 0 240 240" role="img" aria-label="Interactive sample skill map">
                          <polygon className="radar-axis" points="120,25 210,91 176,197 64,197 30,91" />
                          <polygon className="radar-axis" points="120,50 186,98 161,175 79,175 54,98" />
                          <polygon className="radar-axis" points="120,76 162,106 146,153 94,153 78,106" />
                          <line className="radar-spoke" x1="120" y1="120" x2="120" y2="25" /><line className="radar-spoke" x1="120" y1="120" x2="210" y2="91" /><line className="radar-spoke" x1="120" y1="120" x2="176" y2="197" /><line className="radar-spoke" x1="120" y1="120" x2="64" y2="197" /><line className="radar-spoke" x1="120" y1="120" x2="30" y2="91" />
                          <polygon className="radar-value" points="120,43 185,99 161,176 82,172 51,98" />
                          <circle className="radar-point" cx="120" cy="43" r="4" /><circle className="radar-point" cx="185" cy="99" r="4" /><circle className="radar-point" cx="161" cy="176" r="4" /><circle className="radar-point" cx="82" cy="172" r="4" /><circle className="radar-point" cx="51" cy="98" r="4" />
                        </svg>
                        {SKILL_ORDER.map(key => {
                          const active = key === skillKey;
                          return (
                            <button
                              key={key}
                              className={`radar-label label-${key}${active ? " active" : ""}`}
                              type="button"
                              data-skill={key}
                              aria-pressed={active}
                              onClick={() => setActiveSkill(key)}
                            >
                              {SKILL_DATA[key].name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="breakdown-card" aria-live="polite">
                      <span className="card-kicker">Skill breakdown</span>
                      <div className="breakdown-head">
                        <span
                          className="skill-dot"
                          id="skillDot"
                          style={skillTouched ? { background: skill.color, boxShadow: skillDotShadow(skill.color) } : undefined}
                        />
                        <strong id="skillName">{skill.name}</strong>
                      </div>
                      <div className="score-line"><strong id="skillScore">{skill.score}</strong><span id="skillChange">{skill.change}</span></div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          id="progressFill"
                          style={skillTouched ? { width: progressFillWidth(skill.score), background: progressFillBackground(skill.color) } : undefined}
                        />
                      </div>
                      <div className="metric-list" id="metricList">
                        {skill.metrics.map(([key, value]) => (
                          <div className="metric-row" key={key}><span>{key}</span><strong>{value}</strong></div>
                        ))}
                      </div>
                      <p className="focus-note" id="focusNote">{skill.note}</p>
                    </div>
                  </div>
                </div>
              </div>
              <aside className="floating-plan" aria-label="Sample training recommendation"><div className="plan-title"><span className="plan-icon">↗</span><span><strong>Next focus identified</strong><small>Built from repeated test results</small></span></div><div className="plan-item"><span>1</span><span><strong>Deceleration to lateral exit</strong><small>Agility progression</small></span><small>3 × 4</small></div></aside>
            </div>
          </div>
        </section>

        <section id="training">
          <div className="section-shell">
            <div className="section-head center reveal">
              <p className="eyebrow">Profile to plan</p>
              <h2>Training built around the <span>athlete in front of you.</span></h2>
              <p className="section-copy">The drill matrix connects measured needs to relevant exercise tags, progressions, dosage, and retest points—while keeping unmeasured areas honest and goal-led.</p>
            </div>
            <div className="training-layout">
              <div className="plan-board reveal" aria-label="Sample athlete training plan">
                <div className="plan-board-head"><span><strong>Alex’s development plan</strong><small>Priority: braking + redirection</small></span><span className="week-ring"><strong>2/4</strong><span>week</span></span></div>
                <article className="workout"><header><span><span>Workout 01</span><strong>Quality movement + ball</strong></span><span className="workout-status">Up next</span></header><div className="exercise"><span className="exercise-icon">↘</span><span><strong>Deceleration gate</strong><small>3 sets · 4 quality reps · full recovery</small></span><span>▶</span></div><div className="exercise"><span className="exercise-icon">↔</span><span><strong>Planned cut progression</strong><small>3 sets · both directions</small></span><span>▶</span></div><div className="exercise"><span className="exercise-icon">∞</span><span><strong>Tight-box ball mastery</strong><small>3 rounds · 30 seconds</small></span><span>▶</span></div></article>
                <article className="workout"><header><span><span>Retest checkpoint</span><strong>Change-of-direction shuttle</strong></span><span className="workout-status">Week 4</span></header></article>
              </div>
              <div className="training-copy reveal">
                <p className="eyebrow">A disciplined recommendation engine</p>
                <h2>From a measured gap to a <span>clear next step.</span></h2>
                <p className="section-copy">A result does not become a diagnosis. PoseTek uses repeated performance evidence to identify plausible priorities and keeps the coach in the loop.</p>
                <div className="logic-list">
                  <div className="logic-row"><span>✓</span><div><strong>Evidence before priority</strong><small>Valid results across sessions reduce one-clip noise.</small></div></div>
                  <div className="logic-row"><span>↗</span><div><strong>Progressions that fit</strong><small>Training maps to the athlete’s measured dimension, age, level, and practical setup.</small></div></div>
                  <div className="logic-row"><span>⟳</span><div><strong>A built-in feedback loop</strong><small>Retesting shows whether performance is moving and what should come next.</small></div></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="loop-section">
          <div className="section-shell">
            <div className="loop-card reveal">
              <div className="loop-content">
                <p className="eyebrow">Start the athlete’s profile</p>
                <h2>Stop guessing what to work on <span>next.</span></h2>
                <p className="section-copy">Run the test suite. Give the athlete a profile they can understand. Build the next block of work around what the performance actually shows.</p>
                <div className="loop-actions"><a className="button-primary" href="bookPerformanceTest.html">Book a performance test <span>→</span></a><Link className="button-secondary" to="/signin">Coach sign in</Link></div>
              </div>
              <div className="loop-steps" aria-label="PoseTek development loop"><div className="loop-step"><span>1</span>Test</div><div className="loop-step"><span>2</span>Understand</div><div className="loop-step"><span>3</span>Train</div><div className="loop-step"><span>4</span>Retest</div></div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-shell">
          <div><a className="brand" href="#top"><span className="brand-mark">P</span><span>POSETEK</span></a><p className="footer-copy">Soccer performance testing, athlete profiles, and focused development—connected in one system.</p></div>
          <div className="footer-links"><a href="#how-it-works">How it works</a><a href="bookPerformanceTest.html">Book a test</a><Link to="/signin">Sign in</Link><Link to="/privacy">Privacy</Link><span>© 2026 PoseTek</span></div>
        </div>
      </footer>
    </div>
  );
}
