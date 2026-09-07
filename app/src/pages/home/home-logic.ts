// Pure logic ported from the inline <script> of legacy index.html: the sticky
// header threshold, the mobile menu button labels, and the sample skill-map
// data behind the "Athlete home" profile demo.

/** Legacy: `header.classList.toggle('scrolled', window.scrollY > 12)`. */
export const HEADER_SCROLL_THRESHOLD = 12;

export function isHeaderScrolled(scrollY: number): boolean {
  return scrollY > HEADER_SCROLL_THRESHOLD;
}

/** Legacy menu button `aria-label` for the open/closed state. */
export function menuButtonLabel(open: boolean): string {
  return open ? "Close navigation" : "Open navigation";
}

export type SkillKey = "speed" | "shooting" | "power" | "control" | "agility";

export interface SkillEntry {
  name: string;
  score: number;
  color: string;
  change: string;
  metrics: [string, string][];
  note: string;
}

/** Radar label order in the legacy markup (clockwise from the top). */
export const SKILL_ORDER: readonly SkillKey[] = ["speed", "shooting", "power", "control", "agility"];

/** The label marked `active` in the legacy initial DOM. */
export const DEFAULT_SKILL: SkillKey = "agility";

/** Legacy `skillData`, verbatim. */
export const SKILL_DATA: Record<SkillKey, SkillEntry> = {
  speed: {
    name: "Speed",
    score: 81,
    color: "#4bd7e8",
    change: "↑ Improving",
    metrics: [["Total time", "2.41 s"], ["Max velocity", "8.2 m/s"], ["Acceleration", "3.4 m/s²"]],
    note: "Focus: hold speed mechanics through the end of the lane.",
  },
  shooting: {
    name: "Shooting",
    score: 74,
    color: "#ff8c8c",
    change: "↑ Building",
    metrics: [["Ball velocity", "24.7 m/s"], ["Launch angle", "14.2°"], ["Plant offset", "18 cm"]],
    note: "Focus: consistent plant position through ball contact.",
  },
  power: {
    name: "Power",
    score: 72,
    color: "#b7f34a",
    change: "↑ Improving",
    metrics: [["Broad jump", "2.18 m"], ["Jump height", "48 cm"], ["Landing", "Controlled"]],
    note: "Focus: horizontal force without losing landing control.",
  },
  control: {
    name: "Control",
    score: 70,
    color: "#66d6e8",
    change: "→ Developing",
    metrics: [["Shuttle time", "6.18 s"], ["Out phase", "2.55 s"], ["Ball distance", "0.42 m"]],
    note: "Focus: keep the ball in a playable radius through the turn.",
  },
  agility: {
    name: "Agility",
    score: 68,
    color: "#ffbd59",
    change: "↑ Improving",
    metrics: [["Total time", "5.12 s"], ["Start phase", "1.82 s"], ["Turn phase", "1.48 s"]],
    note: "Focus: faster braking and redirection through the turn.",
  },
};

/** Legacy: `skillDot.style.boxShadow = \`0 0 0 5px ${color}1c\`` (hex color + 0x1c alpha). */
export function skillDotShadow(color: string): string {
  return `0 0 0 5px ${color}1c`;
}

/** Legacy: `progressFill.style.width = \`${score}%\``. */
export function progressFillWidth(score: number): string {
  return `${score}%`;
}

/** Legacy: `progressFill.style.background = \`linear-gradient(90deg, ${color}, #b7f34a)\``. */
export function progressFillBackground(color: string): string {
  return `linear-gradient(90deg, ${color}, #b7f34a)`;
}
