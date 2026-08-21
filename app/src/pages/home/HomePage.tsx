// Port of legacy index.html (marketing homepage).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { injectClarity } from "./clarity";
import {
  findNextSection,
  findPreviousSection,
  nextSlideIndex,
  scrollIndicatorVisibility,
} from "./home-logic";
import "./home.scss";

const SLIDES = [
  { src: "/images/postestimation.png", alt: "Pose Estimation", label: "Pose Estimation" },
  { src: "/images/kickanalysis.png", alt: "Kick Analysis", label: "Kick Analysis" },
  { src: "/images/sprintBreakdown.png", alt: "Sprint Tracking", label: "Sprint Tracking" },
  { src: "/images/profilepose.PNG", alt: "Coach Dashboard", label: "Coach Dashboard" },
  { src: "/images/graphpose.PNG", alt: "Progress Over Time", label: "Progress Over Time" },
];

const CAROUSEL_MS = 3000;

export default function HomePage() {
  const [navHidden, setNavHidden] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [upVisible, setUpVisible] = useState(false);
  const [downVisible, setDownVisible] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const tripodRef = useRef<HTMLElement>(null);
  const postRef = useRef<HTMLElement>(null);
  const teamRef = useRef<HTMLElement>(null);
  const carouselInterval = useRef<number | undefined>(undefined);

  // <head> parity: title, Clarity, and `html { scroll-behavior: smooth; }`
  // (the scrolling element can't be reached from the scoped stylesheet).
  useEffect(() => {
    document.title = "PoseTek - Soccer Performance Analytics";
    injectClarity();
    // Full-page-load parity: the browser reset scroll (or jumped to the #hash)
    // on every legacy navigation. Done before enabling smooth scrolling so the
    // reset is instant.
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      document.documentElement.style.scrollBehavior = previous;
    };
  }, []);

  // Scroll Handler (debounced nav hide)
  useEffect(() => {
    let isScrolling: number | undefined;
    const onScroll = () => {
      window.clearTimeout(isScrolling);
      isScrolling = window.setTimeout(() => {
        setNavHidden(window.scrollY > 300);
      }, 100);
    };
    window.addEventListener("scroll", onScroll);
    return () => {
      window.clearTimeout(isScrolling);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Feature Carousel auto-advance
  useEffect(() => {
    carouselInterval.current = window.setInterval(() => {
      setCurrentIndex(index => nextSlideIndex(index, SLIDES.length));
    }, CAROUSEL_MS);
    return () => window.clearInterval(carouselInterval.current);
  }, []);

  function handlePillClick(index: number) {
    // Legacy: clearInterval, jump to the slide, restart the interval.
    window.clearInterval(carouselInterval.current);
    setCurrentIndex(index);
    carouselInterval.current = window.setInterval(() => {
      setCurrentIndex(i => nextSlideIndex(i, SLIDES.length));
    }, CAROUSEL_MS);
  }

  // Section Transition Observer + mobile initialization
  useEffect(() => {
    const sections = [tripodRef.current, postRef.current, teamRef.current].filter(
      (section): section is HTMLElement => section !== null,
    );

    const sectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add("section-visible");
          } else {
            entry.target.classList.remove("section-visible");
          }
        });
      },
      { threshold: 0.25, rootMargin: "0px 0px -100px 0px" },
    );
    sections.forEach(section => sectionObserver.observe(section));

    function handleResize() {
      if (window.innerWidth <= 768) {
        sections.forEach(section => section.classList.add("section-visible"));
      }
    }
    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      sectionObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Scroll Indicators
  useEffect(() => {
    const updateScrollIndicators = () => {
      const hero = heroRef.current;
      if (!hero) return;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const { up, down } = scrollIndicatorVisibility(window.scrollY, hero.offsetHeight, maxScroll);
      setUpVisible(up);
      setDownVisible(down);
    };
    window.addEventListener("scroll", updateScrollIndicators, { passive: true });
    updateScrollIndicators();
    return () => window.removeEventListener("scroll", updateScrollIndicators);
  }, []);

  function snapSections(): HTMLElement[] {
    return [heroRef.current, tripodRef.current, postRef.current, teamRef.current].filter(
      (section): section is HTMLElement => section !== null,
    );
  }

  function handleScrollUp() {
    const sections = snapSections();
    const prev = findPreviousSection(sections.map(s => s.offsetTop), window.scrollY);
    if (prev !== -1) sections[prev].scrollIntoView({ behavior: "smooth" });
  }

  function handleScrollDown() {
    const sections = snapSections();
    const next = findNextSection(sections.map(s => s.offsetTop), window.scrollY);
    if (next !== -1) sections[next].scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="pt-home">
      <header>
        <nav id="mainNav" className={navHidden ? "nav-hidden" : ""}>
          <div className="brand-container">
            <div className="logo">Pose<span>Tek</span></div>
          </div>
          <Link to="/signin" className="nav-cta">Launch PoseTek →</Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <div className="hero-container" ref={heroRef}>
          <div className="hero-inner">
            <div className="hero-text">
              <h1 className="hero-title">A New Form of <em>Deliberate Practice</em></h1>
              <p className="hero-subtitle">Professional-grade biomechanical analysis that helps athletes and coaches understand movement, track development, and unlock performance.</p>
              <div className="hero-actions">
                <a href="#how-it-works" className="btn-hilight">See How It Works <span className="btn-arrow">↓</span></a>
              </div>
            </div>
            <div className="sport-card">
              <div className="image-container">
                {SLIDES.map((slide, index) => (
                  <div
                    key={slide.label}
                    className={`slide${index === currentIndex ? " active" : ""}`}
                    data-index={index}
                  >
                    <div className="slide-card"><img src={slide.src} alt={slide.alt} /></div>
                  </div>
                ))}
              </div>
              <div className="features-strip">
                {SLIDES.map((slide, index) => (
                  <div
                    key={slide.label}
                    className={`feature-pill${index === currentIndex ? " active" : ""}`}
                    data-index={index}
                    data-label={slide.label}
                    onClick={() => handlePillClick(index)}
                  >
                    <div className="feature-pill-dot" />
                    {slide.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* How it works */}
        <section id="how-it-works" className="tripod-section" ref={tripodRef}>
          <div className="tripod-image" style={{ backgroundImage: "url('/images/tripod.png')" }} />
          <div className="tripod-content">
            <span className="section-number">Step 01</span>
            <h2>Set Up Your <em>Tripod</em></h2>
            <p>Position your camera and start the session. Our proprietary technology automatically clips out the relevant actions for you to analyze — no manual editing required.</p>
          </div>
        </section>

        <section className="postestimation-section" ref={postRef}>
          <div className="postestimation-image">
            <div className="postestimation-image-card">
              <img src="/images/analysiskick.PNG" alt="Kick Analysis" />
            </div>
          </div>
          <div className="postestimation-content">
            <span className="section-number">Step 02</span>
            <h2><em>Biomechanical</em> Insights</h2>
            <p>Our app delivers instant biomechanical feedback, tools to guide your players, and statistical models to track individual development over time.</p>
          </div>
        </section>

        <section className="team-section" ref={teamRef}>
          <div className="team-header">
            <span className="team-eyebrow">The People Behind It</span>
            <h2 className="team-title">Meet the <em>Team</em></h2>
          </div>
          <div className="team-grid">
            <div className="team-member">
              <div className="member-image-container">
                <img src="/images/Nolan.png" className="member-image" alt="Nolan Jetter" />
                <div className="member-bio">
                  <p>CEO & Founder with former Div I soccer experience at Lehigh University</p>
                </div>
              </div>
              <div className="member-info">
                <h3 className="member-name">Nolan Jetter</h3>
                <p className="member-title">Chief Executive Officer</p>
              </div>
            </div>

            <div className="team-member">
              <div className="member-image-container">
                <img src="/images/Dylan.png" className="member-image" alt="Dylan Keller" />
                <div className="member-bio">
                  <p>Former Div I soccer player at University of Memphis specializing in market insight</p>
                </div>
              </div>
              <div className="member-info">
                <h3 className="member-name">Dylan Keller</h3>
                <p className="member-title">Chief Marketing Officer</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Scroll Navigation */}
      <div className="scroll-nav" id="scrollNav">
        <button
          className={`scroll-btn${upVisible ? " visible" : ""}`}
          id="scrollUp"
          title="Scroll up"
          onClick={handleScrollUp}
        >
          <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
        <button
          className={`scroll-btn${downVisible ? " visible" : ""}`}
          id="scrollDown"
          title="Scroll down"
          onClick={handleScrollDown}
        >
          <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </div>

      <footer>
        <p>© 2026 PoseTek · <Link to="/signin">Launch App</Link> · <Link to="/privacy">Privacy Policy</Link></p>
      </footer>
    </div>
  );
}
