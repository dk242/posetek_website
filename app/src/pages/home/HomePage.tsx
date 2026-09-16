import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MotionConfig } from "motion/react";
import { useThemeColor } from "../../lib/use-theme-color";
import { useBodyBackground } from "../../lib/use-body-background";
import { TestCards } from "./TestCards";
import { BlurFade } from "../../components/magicui/blur-fade";
import { LazyHomepageDemo } from "./LazyHomepageDemo";
import { AthleteProfile } from "./AthleteProfile";
import { PitchVisual } from "./PitchVisual";
import { MobileAppPreview } from "./MobileAppPreview";
import { injectClarity } from "./clarity";
import { isHeaderScrolled, menuButtonLabel } from "./home-logic";
import "./magic.css";
import "./home.scss";
import "./scrolling-home.scss";
import "./mobile-app-preview.css";

const loadMovement = () => import("./movement/MovementDemo").then(module => ({ default: module.MovementDemo }));
const loadTechnique = () => import("./technique/TechniqueDemo");
const loadCoach = () => import("./product/CoachDemo");
const loadWorkout = () => import("./product/WorkoutDemo");

const journey = [
  { label: "Test", href: "#tests" },
  { label: "Review", href: "#how-it-works" },
  { label: "Compare", href: "#profile" },
  { label: "Train", href: "#training" },
  { label: "Retest", href: "#retest" },
];

function Arrow({ down = false }: { down?: boolean }) {
  return <svg className="arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={down ? { transform: "rotate(90deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

export default function HomePage() {
  useThemeColor("#04130e");
  useBodyBackground("#04130e");
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedDrill, setSelectedDrill] = useState("sprint");
  const [requestedDrill, setRequestedDrill] = useState<{ key: string } | null>(null);
  const [workoutRequest, setWorkoutRequest] = useState({ text: "", id: 0 });
  const menuRef = useRef<HTMLButtonElement>(null);

  const openWorkout = (text: string) => {
    setWorkoutRequest(previous => ({ text, id: previous.id + 1 }));
    document.getElementById("training")?.scrollIntoView();
    document.getElementById("training-title")?.focus({ preventScroll: true });
  };

  useEffect(() => {
    document.title = "PoseTek | Start with evidence. Train what’s next.";
    injectClarity();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    const updateMotion = () => { root.style.scrollBehavior = media.matches ? "auto" : "smooth"; };
    updateMotion();
    media.addEventListener("change", updateMotion);
    const updateHeader = () => setHeaderScrolled(isHeaderScrolled(window.scrollY));
    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
    return () => {
      root.style.scrollBehavior = previous;
      media.removeEventListener("change", updateMotion);
      window.removeEventListener("scroll", updateHeader);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuRef.current?.focus(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menuOpen]);

  return <MotionConfig reducedMotion="user">
    <div className="pt-home">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className={`site-header${headerScrolled ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`}>
        <nav className="nav-shell shell" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="PoseTek home"><span className="brand-mark">P<span /></span><span>POSETEK</span></a>
          <div className="nav-links" id="navLinks">
            <a href="#tests" onClick={() => setMenuOpen(false)}>Tests</a>
            <a href="#profile" onClick={() => setMenuOpen(false)}>Athlete profile</a>
            <a href="#training" onClick={() => setMenuOpen(false)}>Training</a>
            <a href="#ai-coach" onClick={() => setMenuOpen(false)}>AI Coach</a>
            <a href="#technique" onClick={() => setMenuOpen(false)}>Technique</a>
            <a className="mobile-signin" href="/signin">Sign in <Arrow /></a>
          </div>
          <div className="nav-actions"><a className="nav-login" href="/signin">Sign in</a><a className="nav-cta" href="/bookPerformanceTest.html">Book a test <Arrow /></a></div>
          <button className="menu-button" type="button" ref={menuRef} aria-label={menuButtonLabel(menuOpen)} aria-controls="navLinks" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><span /><span /></button>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero shell" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow hero-enter"><span className="status-dot" />For clubs, coaches, and players</p>
            <h1 id="hero-title" className="hero-enter" style={{ "--enter-delay": "80ms" } as CSSProperties}>What should the player train next?<em>Start with evidence.</em></h1>
            <p className="hero-description hero-enter" style={{ "--enter-delay": "160ms" } as CSSProperties}>Six performance tests. One connected mobile app.<br />Understand how a player moves, find their focus,<br className="desktop-break" /> and turn evidence into their next training session.</p>
            <div className="hero-actions hero-enter" style={{ "--enter-delay": "240ms" } as CSSProperties}>
              <a className="hero-explore" href="#tests"><span className="hero-explore-label">See your game differently<span className="hero-explore-track" aria-hidden="true" /></span><span className="hero-explore-orbit" aria-hidden="true"><Arrow down /></span></a>
            </div>
            <a className="hero-mobile-link" href="#mobile-app"><svg viewBox="0 0 16 22" fill="none" aria-hidden="true"><rect x="2" y="1" width="12" height="20" rx="3" stroke="currentColor" strokeWidth="1.3"/><path d="M6 4h4M6 18h4" stroke="currentColor" strokeLinecap="round"/></svg>Explore the PoseTek mobile app <span aria-hidden="true">↗</span></a>
          </div>
          <div className="hero-art">
            <div className="art-coordinate" aria-hidden="true">PT / PERFORMANCE SYSTEM</div>
            <PitchVisual />
          </div>
          <div className="hero-index" aria-label="PoseTek capabilities"><span><strong>06</strong>Performance tests</span><span><strong>33</strong>Tracked joints</span><span><strong>01</strong>Connected system</span><a href="#tests" aria-label="Explore the six tests"><Arrow down /></a></div>
        </section>

        <nav className="journey-nav shell" aria-label="The PoseTek method">{journey.map((step, index) => <a key={step.label} href={step.href}><span>0{index + 1}</span><strong>{step.label}</strong><Arrow /></a>)}</nav>

        <section className="assessment shell section" id="tests" aria-labelledby="tests-title">
          <BlurFade inView blur="3px" direction="up" offset={10} className="section-heading"><div><p className="eyebrow">01 / Test. See. Understand.</p><h2 id="tests-title">Six tests.<br /><em>Every rep tells a story.</em></h2></div><p className="section-description">Six tests reveal how you move, control the ball, and strike.</p></BlurFade>
          <div className="assessment-workspace">
            <TestCards selectedDrill={selectedDrill} onWatch={key => { setSelectedDrill(key); setRequestedDrill({ key }); }} />
            <div id="how-it-works" className="assessment-replay">
              <LazyHomepageDemo load={loadMovement} demoProps={{ requestedDrill, onDrillChange: setSelectedDrill, hideChoices: true }} forceLoad={!!requestedDrill} kind="movement" label="Recorded movement analysis" />
            </div>
          </div>
          <div className="demo-caption"><span>Recorded reps · Six tests · Frame-by-frame playback</span><a className="button-text" href="#profile">Put it in perspective <Arrow down /></a></div>
        </section>

        <section className="profile-section section" id="profile" aria-labelledby="profile-title">
          <div className="profile-layout shell">
            <BlurFade inView blur="3px" direction="up" offset={10} className="profile-copy"><p className="eyebrow">02 / One profile. The whole picture.</p><h2 id="profile-title">Put performance<br /><em>in perspective.</em></h2><p>Bring results together, compare benchmarks, and identify what to train next.</p><div className="profile-benefits"><span><i />Explore five skill areas</span><span><i />Review drill-specific results</span><span><i />Track progress over time</span></div><a className="button-text" href="#training">Find the next step <Arrow down /></a></BlurFade>
            <AthleteProfile />
          </div>
        </section>

        <section className="workout-section section" id="training" aria-labelledby="training-title">
          <div className="shell">
            <BlurFade inView blur="3px" direction="up" offset={10} className="section-heading"><div><p className="eyebrow">03 / Workout planner</p><h2 id="training-title" tabIndex={-1}>Turn results into<br /><em>a focused plan.</em></h2></div><p className="section-description">Turn your focus into guided drills that fit your time and energy.</p></BlurFade>
            <LazyHomepageDemo load={loadWorkout} demoProps={{ initialRequest: workoutRequest.text, requestId: workoutRequest.id }} forceLoad={!!workoutRequest.text} kind="workout" label="Interactive workout planner" />
            <div className="demo-caption"><span>Sample workout · Set your focus · Try a guided session</span><a className="button-text" href="#retest">Close the loop <Arrow down /></a></div>
          </div>
        </section>

        <section className="coach-section retest-section shell section" id="ai-coach" aria-labelledby="retest-title">
          <span id="retest" className="section-anchor" />
          <BlurFade inView blur="3px" direction="up" offset={10} className="section-heading"><div><p className="eyebrow">04 / Retest with AI Coach</p><h2 id="retest-title">Train. Retest.<br /><em>See what changes.</em></h2></div><p className="section-description">Repeat the tests. Understand what changed. Choose your next training focus.</p></BlurFade>
          <LazyHomepageDemo load={loadCoach} demoProps={{ onOpenWorkout: openWorkout }} kind="coach" label="AI Coach sample conversation" />
          <div className="demo-caption"><span>Sample athlete · Previous and latest results · Your next training focus</span><a className="button-text" href="#technique">Look closer at technique <Arrow down /></a></div>
        </section>

        <section className="technique-section shell section" id="technique" aria-labelledby="technique-title">
          <BlurFade inView blur="3px" direction="up" offset={10} className="section-heading"><div><p className="eyebrow">05 / Technique analysis</p><h2 id="technique-title">The rep. The detail.<br /><em>The difference.</em></h2></div><p className="section-description">Pause at key moments. Compare technique. Find a clear coaching focus.</p></BlurFade>
          <LazyHomepageDemo load={loadTechnique} demoProps={{}} kind="technique" label="Recorded technique analysis" />
          <div className="demo-caption"><span>One kick · One cue at a time · Compare the same moment</span><a className="button-text" href="/bookPerformanceTest.html">Establish your baseline <Arrow /></a></div>
        </section>

        <section className="closing section" id="mobile-app" aria-labelledby="closing-title"><div className="shell closing-content mobile-closing-layout"><div className="mobile-closing-copy"><p className="eyebrow">The PoseTek mobile app</p><h2 id="closing-title">Your next session.<br /><em>In your pocket.</em></h2><p>Review your results. Follow your plan. Take your next training step with you.</p><div className="closing-actions"><a className="button-primary" href="/bookPerformanceTest.html">Book a performance test <Arrow /></a><a className="button-text" href="/signin">Coach sign in <Arrow /></a></div></div><MobileAppPreview /></div></section>
      </main>
      <footer className="shell"><a className="brand" href="#top" aria-label="PoseTek home"><span className="brand-mark">P<span /></span><span>POSETEK</span></a><p>Start with evidence. Train what’s next.</p><div className="footer-links"><a href="/bookPerformanceTest.html">Book a test</a><a href="/signin">Sign in</a><a href="/privacy">Privacy</a><span>© 2026 PoseTek</span></div></footer>
    </div>
  </MotionConfig>;
}
