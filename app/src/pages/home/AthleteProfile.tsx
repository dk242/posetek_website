import { useState } from "react";
import { DEFAULT_SKILL, SKILL_DATA, SKILL_ORDER, progressFillBackground, progressFillWidth, skillDotShadow, type SkillKey } from "./home-logic";
export function AthleteProfile() {
  const [activeSkill, setActiveSkill] = useState<SkillKey>(DEFAULT_SKILL);
  const skillKey = activeSkill;
  const skill = SKILL_DATA[skillKey];
  const skillTouched = true;
  return (
            <div className="profile-demo reveal" aria-label="Sample PoseTek athlete profile">
              <div className="demo-window">
                <div className="demo-topbar"><span className="mini-mark">P</span>Athlete profile<span className="live-chip">Sample profile</span></div>
                <div className="demo-content">
                  <div className="athlete-row"><span className="avatar">AJ</span><span><strong>Alex Johnson</strong><small>Midfielder · U17 · Sample profile</small></span><span className="sample-chip">Latest assessment</span></div>
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
            </div>
);
}
