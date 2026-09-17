import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { useThemeColor } from "../../lib/use-theme-color";
import { useBodyBackground } from "../../lib/use-body-background";
import { BlurFade } from "../../components/magicui/blur-fade";
import { MarketingHeader, TEAM_ENQUIRY_HREF } from "../home/MarketingHeader";
import { injectClarity } from "../home/clarity";
import { ClubExplorer } from "./ClubExplorer";
import { PlayerEvidence } from "./PlayerEvidence";
import { DevelopmentJourney } from "./DevelopmentJourney";
import { sampleTeams, resolveTeam, resolvePlayer } from "./coach-samples";
import "../home/magic.css";
import "../home/home.scss";
import "../home/scrolling-home.scss";
import "../home/mobile-app-preview.css";
import "./coaches.scss";

const teamEnquiryHref = TEAM_ENQUIRY_HREF;
export function CoachArrow({ down = false }: { down?: boolean }) {
  return <svg className="arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={down ? { transform: "rotate(90deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

function ClubPreview() {
  const team = sampleTeams[1], player = team.players[0];
  return <figure className="coach-hero-workspace" aria-label="Illustrative club workspace: Northfield FC, three teams and an individual player focus">
    <div className="coach-preview-bar"><span className="coach-mini-logo">P</span><span>Club workspace</span><span>Illustrative example</span></div>
    <div className="coach-preview-club"><span className="coach-club-crest" aria-hidden="true">N<span>FC</span></span><div><span className="coach-micro">THE WHOLE CLUB, CONNECTED</span><strong>Northfield FC</strong><span>One view. Individual next steps.</span></div><span className="coach-preview-live" aria-hidden="true" /></div>
    <div className="coach-preview-teams">{sampleTeams.map(item => <div key={item.id} data-selected={item.id === team.id}><span>{item.name}</span><small>{item.players.length} sample players</small><span aria-hidden="true">↗</span></div>)}</div>
    <div className="coach-preview-main">
      <div className="coach-preview-pitch" aria-hidden="true"><svg viewBox="0 0 280 270"><rect x="20" y="18" width="240" height="232" rx="4"/><path d="M20 134H260M95 18V62H185V18M95 250V206H185V250"/><circle cx="140" cy="134" r="36"/><path className="coach-pitch-pass" d="M67 185L140 132L214 185M140 132V62"/>{[[140,62],[67,185],[214,185]].map(([x,y],i)=><g key={i}><circle className="coach-pitch-player" cx={x} cy={y} r="17"/><text x={x} y={y+4}>{[8,6,10][i]}</text></g>)}<circle className="coach-pitch-selected" cx="140" cy="132" r="23"/><text className="coach-pitch-number" x="140" y="137">{player.number}</text></svg><span>Team context → Player focus</span></div>
      <div className="coach-preview-focus"><span className="coach-micro">INDIVIDUAL NEXT STEP</span><span className="coach-preview-avatar" aria-hidden="true">{player.name.split(" ").map(part=>part[0]).join("")}</span><strong>{player.name}</strong><span>{player.position} · {team.name}</span><div><small>Training focus</small><b>{player.focus}</b></div><p>Evidence from testing.<br/>A plan for the player.</p></div>
    </div>
    <figcaption><span className="status-dot"/>Testing <span>→</span> Insight <span>→</span> Training <span>→</span> Retest</figcaption>
  </figure>;
}

export default function CoachesPage() {
  useThemeColor("#04130e");
  useBodyBackground("#04130e");
  const [teamId, setTeamId] = useState(sampleTeams[0].id);
  const [playerId, setPlayerId] = useState(sampleTeams[0].players[0].id);
  const team = resolveTeam(teamId), player = resolvePlayer(teamId, playerId);
  const selectTeam = (id: string) => { const next = resolveTeam(id); setTeamId(next.id); setPlayerId(next.players[0].id); };
  useEffect(() => {
    injectClarity();
    const root = document.documentElement, previous = root.style.scrollBehavior;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { root.style.scrollBehavior = media.matches ? "auto" : "smooth"; };
    update(); media.addEventListener("change", update);
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
    return () => { root.style.scrollBehavior = previous; media.removeEventListener("change", update); };
  }, []);
  return <MotionConfig reducedMotion="user"><div className="pt-home pt-coaches">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <MarketingHeader audience="coaches" />
    <main id="main-content">
      <section className="coach-hero shell" id="top" aria-labelledby="coach-hero-title">
        <div className="coach-hero-copy"><p className="eyebrow hero-enter"><span className="status-dot"/>For coaches and club leaders</p><h1 id="coach-hero-title" className="hero-enter">What should your team train next?<em>Start with evidence.</em></h1><p className="coach-hero-description hero-enter">Testing, individual insight, and ongoing support.<br/>Tailored to each team in your club.</p><a className="hero-explore hero-enter" href="#club"><span className="hero-explore-label">Explore the team approach<span className="hero-explore-track" aria-hidden="true"/></span><span className="hero-explore-orbit"><CoachArrow down/></span></a><span className="coach-hero-note">See the team. Understand the individual.</span></div>
        <ClubPreview/>
        <div className="coach-service-strip"><span><strong>Club-wide</strong> perspective</span><span><strong>Team-by-team</strong> support</span><span><strong>Player-by-player</strong> focus</span></div>
      </section>
      <section className="section shell coach-club-section" id="club" aria-labelledby="club-title">
        <BlurFade inView offset={10} className="section-heading"><div><p className="eyebrow">01 / Your club, connected</p><h2 id="club-title">One club. Every team.<br/><em>Each player.</em></h2></div><p className="section-description">Managers see across the club. Coaches stay connected to their teams. Every player keeps their own profile.</p></BlurFade>
        <ClubExplorer teamId={teamId} onTeamChange={selectTeam}/>
        <div className="coach-section-foot"><span>One team or several. The same connected approach.</span><a className="button-text" href="#players">Look at each player <CoachArrow down/></a></div>
      </section>
      <section className="section coach-evidence-section" id="players" aria-labelledby="players-title"><div className="shell">
        <BlurFade inView offset={10} className="section-heading"><div><p className="eyebrow">02 / Evidence for every player</p><h2 id="players-title">A shared starting point.<br/><em>Individual priorities.</em></h2></div><p className="section-description">Six tests reveal how players move and perform. Review each profile to find a clear training focus.</p></BlurFade>
        <PlayerEvidence teamId={teamId} playerId={playerId} onPlayerChange={setPlayerId}/>
        <div className="coach-test-strip" aria-label="Six performance tests"><span>THE SIX TESTS</span>{["Sprint","Vertical jump","Broad jump","Dribbling","Change of direction","Shooting"].map(test=><span key={test}>{test}</span>)}</div>
        <a className="button-text coach-test-link" href="/#tests">Explore the testing experience <CoachArrow/></a>
      </div></section>
      <section className="section shell coach-development-section" id="development" aria-labelledby="development-title">
        <BlurFade inView offset={10} className="section-heading"><div><p className="eyebrow">03 / From results to the next session</p><h2 id="development-title">Keep development moving.<br/><em>Between every test.</em></h2></div><p className="section-description">PoseTek supports the plan. Coaches see the progress. Players take the next step in the mobile app.</p></BlurFade>
        <DevelopmentJourney key={player.id} player={player} teamName={team.name}/>
      </section>
      <section className="section coach-contact" id="contact" aria-labelledby="contact-title"><div className="shell">
        <div className="coach-contact-heading"><div><p className="eyebrow">Built around your teams</p><h2 id="contact-title">Let’s plan your team’s<br/>next step.</h2></div><p>Tell us about your teams and priorities. We’ll arrange testing and ongoing support around your club.</p></div>
        <ol className="coach-service-steps"><li><span>01</span><strong>Discuss your teams</strong><p>Your players, your priorities.</p></li><li><span>02</span><strong>Arrange testing</strong><p>A shared starting point.</p></li><li><span>03</span><strong>Agree ongoing support</strong><p>A next step for each team.</p></li></ol>
        <div className="coach-contact-actions"><a className="button-primary" href={teamEnquiryHref}>Talk about your team <CoachArrow/></a><a className="button-text" href="/signin">Coach sign in <CoachArrow/></a><span>Let’s start with a conversation.</span></div>
      </div></section>
    </main>
    <footer className="shell"><a className="brand" href="/" aria-label="PoseTek home"><span className="brand-mark">P<span/></span><span>POSETEK</span></a><p>Start with evidence. Train what’s next.</p><div className="footer-links"><a href="/">For players</a><a href={teamEnquiryHref}>Talk to PoseTek</a><a href="/privacy">Privacy</a><span>© 2026 PoseTek</span></div></footer>
  </div></MotionConfig>;
}
