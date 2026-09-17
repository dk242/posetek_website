import { useEffect, useId, useRef, useState } from "react";
import { isHeaderScrolled, menuButtonLabel } from "./home-logic";
import "./marketing-header.css";

export type MarketingAudience = "players" | "coaches";
export const TEAM_ENQUIRY_HREF = "mailto:dylank@posetek.net?subject=PoseTek%20team%20enquiry";

const sectionLinks = {
  players: [
    ["Tests", "#tests"],
    ["Athlete profile", "#profile"],
    ["Training", "#training"],
    ["AI Coach", "#ai-coach"],
    ["Technique", "#technique"],
  ],
  coaches: [
    ["Your club", "#club"],
    ["Every player", "#players"],
    ["Development", "#development"],
    ["Get in touch", "#contact"],
  ],
} as const;

function HeaderArrow() {
  return <svg className="arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

/** Shared public navigation. Audience links are real page routes, not demo tabs. */
export function MarketingHeader({ audience }: { audience: MarketingAudience }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const cta = audience === "coaches"
    ? { label: "Talk about your team", href: TEAM_ENQUIRY_HREF }
    : { label: "Book a test", href: "/bookPerformanceTest.html" };

  useEffect(() => {
    const update = () => setScrolled(isHeaderScrolled(window.scrollY));
    update();
    window.addEventListener("scroll", update, { passive: true });
    const desktop = window.matchMedia("(min-width: 1181px)");
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      window.removeEventListener("scroll", update);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [menuOpen]);

  return <header ref={header} className={`site-header marketing-header${scrolled ? " scrolled" : ""}${menuOpen ? " menu-open" : ""}`}>
    <nav className="nav-shell shell" aria-label="Primary navigation">
      <a className="brand" href="#top" aria-label="PoseTek home"><span className="brand-mark">P<span /></span><span className="brand-wordmark">POSETEK</span></a>
      <div className="audience-switch" role="group" aria-label="Explore PoseTek for">
        <a href="/" aria-current={audience === "players" ? "page" : undefined}>Players</a>
        <a href="/coaches" aria-current={audience === "coaches" ? "page" : undefined}>Coaches</a>
      </div>
      <div className="nav-links" id={menuId}>
        {sectionLinks[audience].map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        <a className="marketing-menu-signin" href="/signin">{audience === "coaches" ? "Coach sign in" : "Sign in"}<HeaderArrow /></a>
        <a className="marketing-menu-cta" href={cta.href}>{cta.label}<HeaderArrow /></a>
      </div>
      <div className="nav-actions"><a className="nav-login" href="/signin">Sign in</a><a className="nav-cta" href={cta.href}>{cta.label}<HeaderArrow /></a></div>
      <button className="menu-button" type="button" ref={menuButton} aria-label={menuButtonLabel(menuOpen)} aria-controls={menuId} aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><span /><span /></button>
    </nav>
  </header>;
}
