import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MotionConfig } from "motion/react";
import { useThemeColor } from "../../lib/use-theme-color";
import { useBodyBackground } from "../../lib/use-body-background";
import { TestCards } from "./TestCards";
import { BlurFade } from "../../components/magicui/blur-fade";
import { LazyPoseDemo } from "./LazyPoseDemo";
import { AthleteProfile } from "./AthleteProfile";
import { PitchVisual } from "./PitchVisual";
import { injectClarity } from "./clarity";
import { isHeaderScrolled, menuButtonLabel } from "./home-logic";
import "./magic.css";
import "./home.scss";

function Arrow({ down = false }: { down?: boolean }) {
  return <svg className="arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={down ? { transform: "rotate(90deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

export default function HomePage() {
  useThemeColor("#04130e");
  useBodyBackground("#04130e");
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [requestedDrill, setRequestedDrill] = useState<{ key: string } | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

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
            <a href="#tests" onClick={() => setMenuOpen(false)}>The tests</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>The analysis</a>
            <a href="#training" onClick={() => setMenuOpen(false)}>The plan</a>
            <a className="mobile-signin" href="/signin">Sign in <Arrow /></a>
          </div>
          <div className="nav-actions"><a className="nav-login" href="/signin">Sign in</a><a className="nav-cta" href="/bookPerformanceTest.html">Book a test <Arrow /></a></div>
          <button className="menu-button" type="button" ref={menuRef} aria-label={menuButtonLabel(menuOpen)} aria-controls="navLinks" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><span /><span /></button>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero shell" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow hero-enter"><span className="status-dot" />For coaches, clubs, and players</p>
            <h1 id="hero-title" className="hero-enter" style={{ "--enter-delay": "80ms" } as CSSProperties}>What should your players train next?<em>Start with evidence.</em></h1>
            <p className="hero-description hero-enter" style={{ "--enter-delay": "160ms" } as CSSProperties}>Six performance tests. One athlete profile.<br />A focused plan for what comes next.</p>
            <div className="hero-actions hero-enter" style={{ "--enter-delay": "240ms" } as CSSProperties}><a className="button-primary" href="/bookPerformanceTest.html">Book a performance test <Arrow /></a><a className="button-text" href="#tests">Explore the system <Arrow down /></a></div>
          </div>
          <div className="hero-art">
            <div className="art-coordinate" aria-hidden="true">PT / PERFORMANCE SYSTEM<br /><span>33 KEYPOINTS / FULL PERSPECTIVE</span></div>
            <PitchVisual />
            <div className="art-caption"><span className="status-dot" />Every player has a next step.<span className="art-cross" aria-hidden="true">+</span></div>
          </div>
          <div className="hero-index" aria-label="PoseTek capabilities"><span><strong>06</strong>Performance tests</span><span><strong>33</strong>Tracked joints</span><span><strong>01</strong>Connected system</span><a href="#tests" aria-label="Explore the six tests"><Arrow down /></a></div>
        </section>

        <section className="assessment shell section" id="tests" aria-labelledby="tests-title">
          <BlurFade inView blur="3px" direction="up" offset={10} className="section-heading"><div><p className="eyebrow">01 / Establish the baseline</p><h2 id="tests-title">Start with<br /><em>six tests.</em></h2></div><p className="section-description">A clear picture of how a player moves,<br className="desktop-break" /> controls the ball, and strikes.</p></BlurFade>
          <TestCards onWatch={key => setRequestedDrill({ key })} />
        </section>

        <section className="analysis section" id="how-it-works" aria-labelledby="analysis-title">
          <div className="shell">
            <BlurFade inView blur="3px" direction="up" offset={10} className="section-heading"><div><p className="eyebrow">02 / Look closer</p><h2 id="analysis-title">See the movement.<br /><em>Understand the result.</em></h2></div><p className="section-description">Review each rep with pose tracking<br className="desktop-break" /> and drill-specific metrics.</p></BlurFade>
            <div className="analysis-layout"><LazyPoseDemo requestedDrill={requestedDrill} /><aside className="analysis-note"><span className="eyebrow">Behind every number</span><h3>The rep.<br />The detail.<br /><em>The difference.</em></h3><p>Switch drills. Scrub the timeline.<br />See what happened, frame by frame.</p><a className="button-text" href="#profile">See the athlete profile <Arrow /></a><div className="tracking-mark" aria-hidden="true"><span>33</span><small>POINTS OF<br />PERSPECTIVE</small></div></aside></div>
            <div className="profile-layout" id="profile"><div className="profile-copy"><p className="eyebrow">One profile. The whole picture.</p><h3>Put performance<br /><em>in perspective.</em></h3><p>Compare results with benchmarks in one athlete profile.</p><div className="profile-benefits"><span><i />Explore five skill areas</span><span><i />Review drill-specific results</span><span><i />Track progress over time</span></div></div><AthleteProfile /></div>
          </div>
        </section>

        <section className="training shell section" id="training" aria-labelledby="training-title">
          <div className="training-layout"><BlurFade inView blur="3px" direction="up" offset={10} className="training-copy"><p className="eyebrow">03 / Make it actionable</p><h2 id="training-title">Turn results into<br /><em>a focused plan.</em></h2><p className="section-description">Follow drill demonstrations and practical coaching cues. Retest, compare sessions, and guide the next training block.</p><a className="button-text" href="/bookPerformanceTest.html">Find your starting point <Arrow /></a></BlurFade>
            <div className="training-board" aria-label="Sample athlete training plan"><div className="board-heading"><div><span className="eyebrow">Sample development plan</span><h3>Alex’s next session</h3></div><span className="week-chip">Week <strong>2 / 4</strong></span></div><div className="plan-priority"><span className="status-dot" />Focus: braking + redirection</div><ol className="exercise-list"><li><span className="exercise-number">01</span><div><strong>Deceleration gate</strong><small>3 sets · 4 quality reps · full recovery</small></div><span className="exercise-arrow" aria-hidden="true">↘</span></li><li><span className="exercise-number">02</span><div><strong>Planned cut progression</strong><small>3 sets · both directions</small></div><span className="exercise-arrow" aria-hidden="true">↔</span></li><li><span className="exercise-number">03</span><div><strong>Tight-box ball mastery</strong><small>3 rounds · 30 seconds</small></div><span className="exercise-arrow" aria-hidden="true">∞</span></li></ol><div className="retest-note"><span>Week 4 / Retest</span><strong>Change-of-direction shuttle <span aria-hidden="true">↗</span></strong></div></div>
          </div>
          <ol className="development-loop" aria-label="PoseTek development loop">{["Test", "Review", "Compare", "Train", "Retest"].map((step, index) => <li key={step}><span>0{index + 1}</span><strong>{step}</strong>{index < 4 ? <Arrow /> : <span className="loop-return" aria-hidden="true">↺</span>}</li>)}</ol>
        </section>

        <section className="closing section" aria-labelledby="closing-title"><div className="shell closing-content"><p className="eyebrow">Your next step starts here</p><h2 id="closing-title">Make the next<br /><em>session count.</em></h2><p>One connected system for coaches, clubs, and players.</p><div className="closing-actions"><a className="button-primary" href="/bookPerformanceTest.html">Book a performance test <Arrow /></a><a className="button-text" href="/signin">Coach sign in <Arrow /></a></div><span className="closing-watermark" aria-hidden="true">PT</span></div></section>
      </main>
      <footer className="shell"><a className="brand" href="#top" aria-label="PoseTek home"><span className="brand-mark">P<span /></span><span>POSETEK</span></a><p>Start with evidence. Train what’s next.</p><div className="footer-links"><a href="/bookPerformanceTest.html">Book a test</a><a href="/signin">Sign in</a><a href="/privacy">Privacy</a><span>© 2026 PoseTek</span></div></footer>
    </div>
  </MotionConfig>;
}
