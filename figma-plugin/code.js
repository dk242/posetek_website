// PoseTek × Edge — Instagram Carousel Figma Plugin
// Builds all 5 slides as editable 1080×1350 frames on the current Figma canvas.
// Run via: Plugins → Development → Open Console, paste this file, or load as a dev plugin.

const PALETTE = {
  deep:      { r: 0.102, g: 0.227, b: 0.180 }, // #1A3A2E
  mid:       { r: 0.176, g: 0.369, b: 0.290 }, // #2D5E4A
  accent:    { r: 0.298, g: 0.549, b: 0.416 }, // #4C8C6A
  accentSoft:{ r: 0.859, g: 0.925, b: 0.882 }, // #DBECE2
  paper:     { r: 0.969, g: 0.973, b: 0.965 }, // #F7F8F6
  paper2:    { r: 0.929, g: 0.957, b: 0.937 }, // #EDF4EF
  ink:       { r: 0.063, g: 0.098, b: 0.082 }, // #101915
  muted:     { r: 0.373, g: 0.427, b: 0.400 }, // #5F6D66
  white:     { r: 1,     g: 1,     b: 1     },
  black:     { r: 0,     g: 0,     b: 0     },
  darkBg:    { r: 0.051, g: 0.122, b: 0.094 }, // #0D1F18
  darkBg2:   { r: 0.090, g: 0.192, b: 0.149 }, // #173126
};

const W = 1080;
const H = 1350;
const GAP = 1120; // horizontal spacing between frames

// ─── helpers ───────────────────────────────────────────────────────────────

function rgb(c) { return [{ type: 'SOLID', color: c }]; }

function rgba(c, a) { return [{ type: 'SOLID', color: c, opacity: a }]; }

async function loadFont(family, style) {
  await figma.loadFontAsync({ family, style });
}

async function preloadFonts() {
  const loads = [
    loadFont('Inter', 'Regular'),
    loadFont('Inter', 'Medium'),
    loadFont('Inter', 'Semi Bold'),
    loadFont('Inter', 'Bold'),
    loadFont('Inter', 'Extra Bold'),
  ];
  // Poppins may not be available in all Figma accounts — fall back to Inter Bold
  try { await loadFont('Poppins', 'Bold'); } catch (_) {}
  try { await loadFont('Poppins', 'Extra Bold'); } catch (_) {}
  await Promise.all(loads);
}

function headlineFont() {
  try { figma.loadFontAsync({ family: 'Poppins', style: 'Bold' }); return 'Poppins'; }
  catch (_) { return 'Inter'; }
}

function makeFrame(name, x, y, w, h, bg) {
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  f.x = x;
  f.y = y;
  f.fills = bg ? rgb(bg) : [];
  f.cornerRadius = 0;
  f.clipsContent = true;
  return f;
}

function makeRect(name, x, y, w, h, fills, radius = 0) {
  const r = figma.createRectangle();
  r.name = name;
  r.x = x; r.y = y;
  r.resize(w, h);
  r.fills = fills;
  r.cornerRadius = radius;
  return r;
}

function makeText(parent, content, x, y, w, size, weight, color, lineH, letterSpacing = 0, family = 'Inter') {
  const t = figma.createText();
  t.name = content.slice(0, 40);
  t.x = x; t.y = y;
  t.resize(w, 10);
  t.textAutoResize = 'HEIGHT';
  t.fontName = { family, style: weight };
  t.fontSize = size;
  t.fills = rgb(color);
  if (lineH) t.lineHeight = { value: lineH * size, unit: 'PIXELS' };
  if (letterSpacing) t.letterSpacing = { value: letterSpacing, unit: 'PERCENT' };
  t.characters = content;
  parent.appendChild(t);
  return t;
}

function makePill(parent, label, x, y, bgColor, bgOpacity, borderColor, textColor) {
  const pill = figma.createFrame();
  pill.name = `Pill / ${label}`;
  pill.layoutMode = 'HORIZONTAL';
  pill.primaryAxisSizingMode = 'AUTO';
  pill.counterAxisSizingMode = 'AUTO';
  pill.paddingLeft = 18; pill.paddingRight = 18;
  pill.paddingTop = 12; pill.paddingBottom = 12;
  pill.itemSpacing = 10;
  pill.cornerRadius = 999;
  pill.fills = rgba(bgColor, bgOpacity);
  pill.strokes = [{ type: 'SOLID', color: borderColor, opacity: 0.22 }];
  pill.strokeWeight = 1;
  pill.x = x; pill.y = y;

  // dot
  const dot = figma.createEllipse();
  dot.name = 'dot';
  dot.resize(9, 9);
  dot.fills = rgb(PALETTE.accent);
  pill.appendChild(dot);

  const t = figma.createText();
  t.name = 'label';
  t.fontName = { family: 'Inter', style: 'Bold' };
  t.fontSize = 14;
  t.fills = rgb(textColor);
  t.letterSpacing = { value: 6, unit: 'PERCENT' };
  t.characters = label.toUpperCase();
  pill.appendChild(t);

  parent.appendChild(pill);
  return pill;
}

function makeCard(parent, name, x, y, w, h, bg, bgOpacity, radius = 24) {
  const card = makeFrame(name, x, y, w, h, null);
  card.fills = rgba(bg, bgOpacity);
  card.cornerRadius = radius;
  card.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.1 }];
  card.strokeWeight = 1;
  parent.appendChild(card);
  return card;
}

function makeBrandMark(parent, dark = false) {
  const t = figma.createText();
  t.name = 'Wordmark / PoseTek';
  t.x = W - 48 - 120; t.y = 48;
  t.resize(120, 10);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  t.fontName = { family: 'Inter', style: 'Extra Bold' };
  t.fontSize = 24;
  t.fills = rgb(dark ? PALETTE.white : PALETTE.deep);
  t.letterSpacing = { value: -3, unit: 'PERCENT' };
  t.characters = 'PoseTek';
  parent.appendChild(t);
}

// ─── Slide 1 — Hero advert ─────────────────────────────────────────────────

async function buildSlide1(offsetX) {
  const frame = makeFrame('01 · Hero advert', offsetX, 0, W, H, PALETTE.paper);

  // background accent orb
  const orb = makeRect('Accent / orb', -70, H - 50 - 320, 320, 320, rgba(PALETTE.accent, 0.15), 999);
  frame.appendChild(orb);

  // accent ring
  const ring = makeRect('Accent / ring', W - 280 - 200, 160, 200, 200, [], 999);
  ring.strokes = [{ type: 'SOLID', color: PALETTE.accent, opacity: 0.24 }];
  ring.strokeWeight = 1;
  frame.appendChild(ring);

  makeBrandMark(frame);

  // pill
  makePill(frame, 'Included with Edge', 48, 48 + 34, PALETTE.accent, 0.12, PALETTE.accent, PALETTE.deep);

  // headline
  const hf = headlineFont();
  await loadFont(hf, 'Bold').catch(() => {});
  makeText(frame, 'With every Edge session get PoseTek for free', 48, 160, 600, 88, 'Bold', PALETTE.ink, 0.96, -5, hf);

  // lead copy
  makeText(frame, 'Train. Track. Improve. Premium soccer performance analysis that feels modern, athletic, and easy to understand.', 48, 440, 500, 28, 'Regular', PALETTE.muted, 1.5);

  // mini pills row
  const pillLabels = ['Clean', 'Creative', 'Player-led'];
  let px = 48;
  for (const label of pillLabels) {
    const mp = makeRect(`MiniPill / ${label}`, px, 570, 0, 50, rgba(PALETTE.white, 0.82), 999);
    mp.resize(label.length * 13 + 36, 50);
    mp.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.14 }];
    mp.strokeWeight = 1;
    frame.appendChild(mp);
    makeText(frame, label, px + 18, 583, label.length * 13, 18, 'Bold', PALETTE.deep, 1.4);
    px += label.length * 13 + 36 + 14;
  }

  // player image placeholder zone
  const zone = makeFrame('Image zone / Player cutout (replace with PNG)', 756, 140, 276, 1010, null);
  zone.fills = [
    { type: 'SOLID', color: PALETTE.accentSoft, opacity: 0.82 },
  ];
  zone.cornerRadius = 32;
  zone.strokes = [{ type: 'SOLID', color: PALETTE.accent, opacity: 0.28 }];
  zone.strokeWeight = 2;
  // dashed border note — Figma doesn't support dashed via API easily, stroke conveys intent
  frame.appendChild(zone);

  // label inside zone
  makeText(zone, '⬆ Replace with player PNG', 20, zone.height - 120, 236, 16, 'Bold', PALETTE.deep, 1.4);
  makeText(zone, 'Keep subject large, feet visible, ball motion facing inward.', 20, zone.height - 90, 236, 13, 'Regular', PALETTE.muted, 1.5);

  return frame;
}

// ─── Slide 2 — What is PoseTek? ────────────────────────────────────────────

async function buildSlide2(offsetX) {
  const frame = makeFrame('02 · What is PoseTek?', offsetX, 0, W, H, PALETTE.paper);
  makeBrandMark(frame);

  makePill(frame, 'What is PoseTek?', 48, 48, PALETTE.accent, 0.12, PALETTE.accent, PALETTE.deep);

  const hf = headlineFont();
  makeText(frame, 'A soccer performance platform that turns movement into insights.', 48, 130, 560, 72, 'Bold', PALETTE.ink, 0.96, -5, hf);

  makeText(frame, 'Use simple visuals, concise copy, and recognizable product screens to explain what PoseTek does in one quick scroll-stopping slide.', 48, 410, 500, 26, 'Regular', PALETTE.muted, 1.5);

  // mini pills
  const pills2 = ['Analyze', 'Track', 'Develop'];
  let px2 = 48;
  for (const label of pills2) {
    const mp = makeRect(`MiniPill/${label}`, px2, 560, label.length * 13 + 36, 50, rgba(PALETTE.white, 0.82), 999);
    mp.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.14 }]; mp.strokeWeight = 1;
    frame.appendChild(mp);
    makeText(frame, label, px2 + 18, 573, label.length * 13, 18, 'Bold', PALETTE.deep, 1.4);
    px2 += label.length * 13 + 36 + 14;
  }

  // device stack panel
  const panel = makeFrame('Device stack', 600, 80, 432, 1020, null);
  panel.fills = [{ type: 'SOLID', color: PALETTE.paper2, opacity: 0.95 }];
  panel.cornerRadius = 28;
  panel.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.12 }]; panel.strokeWeight = 1;
  frame.appendChild(panel);

  // primary screen
  const s1 = makeRect('Screen / postestimation.png', 20, 20, 240, 720, rgba(PALETTE.darkBg2, 1), 22);
  panel.appendChild(s1);
  makeText(panel, 'postestimation.png', 28, 340, 224, 12, 'Regular', PALETTE.white, 1.4);

  // secondary screen
  const s2 = makeRect('Screen / profilepose.PNG', 272, 20, 140, 720, rgba(PALETTE.darkBg, 1), 22);
  panel.appendChild(s2);
  makeText(panel, 'profilepose.PNG', 278, 340, 130, 12, 'Regular', PALETTE.white, 1.4);

  // quote card
  const qcard = makeCard(frame, 'Quote card', 48, H - 220, 336, 140, PALETTE.white, 0.96);
  makeText(qcard, 'BRAND FEEL', 22, 18, 290, 13, 'Extra Bold', PALETTE.accent, 1.4, 10);
  makeText(qcard, 'Elite soccer development made visible through clean, premium, coach-friendly UI.', 22, 44, 292, 22, 'Bold', PALETTE.ink, 1.35);

  return frame;
}

// ─── Slide 3 — Biomechanics ─────────────────────────────────────────────────

async function buildSlide3(offsetX) {
  const frame = makeFrame('03 · Biomechanics', offsetX, 0, W, H, PALETTE.darkBg);

  // dark gradient bg overlay
  const grad = makeRect('Bg gradient', 0, 0, W, H, [], 0);
  grad.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { ...PALETTE.darkBg, a: 1 } },
      { position: 1, color: { ...PALETTE.darkBg2, a: 1 } },
    ],
  }];
  frame.appendChild(grad);

  makeBrandMark(frame, true);

  makePill(frame, 'Biomechanics', 48, 48, PALETTE.accent, 0.18, PALETTE.white, PALETTE.white);

  const hf = headlineFont();
  makeText(frame, 'See the details behind kick, sprint, and jump performance.', 48, 130, 480, 68, 'Bold', PALETTE.white, 0.96, -5, hf);
  makeText(frame, 'Darker contrast makes analysis feel advanced and performance-driven.', 48, 360, 460, 26, 'Regular', PALETTE.white, 1.5);

  // feature panel
  const panel3 = makeFrame('Feature panel', 548, 48, 484, 1180, null);
  panel3.fills = [{ type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: 0.067, g: 0.110, b: 0.090, a: 0.95 } },
      { position: 1, color: { r: 0.106, g: 0.180, b: 0.149, a: 0.96 } },
    ],
  }];
  panel3.cornerRadius = 28;
  panel3.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.12 }]; panel3.strokeWeight = 1;
  frame.appendChild(panel3);

  // main feature image area
  const fi = makeRect('Image / analysiskick.PNG', 20, 20, 444, 540, rgba(PALETTE.darkBg2, 1), 24);
  panel3.appendChild(fi);
  makeText(panel3, 'analysiskick.PNG', 28, 270, 420, 12, 'Regular', PALETTE.white, 1.4);

  // three feature cards
  const cards3 = [
    { title: 'Kick analysis', body: 'Break down striking mechanics — body position, timing, and sequencing.' },
    { title: 'Sprint tracking', body: 'Measure explosive movement with high-contrast stat cues.' },
    { title: 'Jump analysis', body: 'Highlight power and efficiency with pose points and motion accents.' },
  ];
  let cy = 580;
  for (const c of cards3) {
    const card = makeCard(panel3, `Card / ${c.title}`, 20, cy, 444, 170, PALETTE.white, 0.08, 20);
    card.strokes = [{ type: 'SOLID', color: PALETTE.white, opacity: 0.08 }]; card.strokeWeight = 1;
    makeText(card, c.title.toUpperCase(), 18, 18, 400, 13, 'Extra Bold', PALETTE.accent, 1.4, 10);
    makeText(card, c.title, 18, 42, 400, 26, 'Bold', PALETTE.white, 1.3);
    makeText(card, c.body, 18, 82, 408, 18, 'Regular', PALETTE.white, 1.5);
    cy += 186;
  }

  return frame;
}

// ─── Slide 4 — Progress over time ──────────────────────────────────────────

async function buildSlide4(offsetX) {
  const frame = makeFrame('04 · Progress over time', offsetX, 0, W, H, PALETTE.paper);
  makeBrandMark(frame);

  makePill(frame, 'Progress over time', 48, 48, PALETTE.accent, 0.12, PALETTE.accent, PALETTE.deep);

  const hf = headlineFont();
  makeText(frame, 'Track measurable improvement across every session.', 48, 130, 480, 68, 'Bold', PALETTE.ink, 0.96, -5, hf);
  makeText(frame, 'Charts, benchmark cards, and calm spacing make this feel dependable and data-driven.', 48, 360, 460, 26, 'Regular', PALETTE.muted, 1.5);

  // progress panel
  const panel4 = makeFrame('Progress panel', 548, 48, 484, 1252, null);
  panel4.fills = [{ type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { ...PALETTE.white, a: 0.92 } },
      { position: 1, color: { ...PALETTE.paper2, a: 0.96 } },
    ],
  }];
  panel4.cornerRadius = 28;
  panel4.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.12 }]; panel4.strokeWeight = 1;
  frame.appendChild(panel4);

  // chart area
  const chart = makeRect('Image / graphpose.PNG', 20, 20, 444, 700, rgba(PALETTE.darkBg2, 1), 26);
  panel4.appendChild(chart);
  makeText(panel4, 'graphpose.PNG', 28, 360, 420, 12, 'Regular', PALETTE.white, 1.4);

  // stat cards
  const stats = [
    { label: 'Session trend', value: '+12%', body: 'Athlete\'s recent gain at a glance.' },
    { label: 'Key metric', value: 'Consistency', body: 'One benchmark card, not a stat wall.' },
    { label: 'Coach value', value: 'Actionable', body: 'Guide development over time.' },
  ];
  let sx = 20;
  for (const s of stats) {
    const sc = makeCard(panel4, `Stat / ${s.label}`, sx, 740, 135, 170, PALETTE.white, 0.96, 20);
    makeText(sc, s.label.toUpperCase(), 14, 14, 107, 11, 'Extra Bold', PALETTE.accent, 1.4, 10);
    makeText(sc, s.value, 14, 38, 107, 28, 'Bold', PALETTE.ink, 1.05);
    makeText(sc, s.body, 14, 82, 107, 15, 'Regular', PALETTE.muted, 1.45);
    sx += 151;
  }

  return frame;
}

// ─── Slide 5 — Players & coaches ───────────────────────────────────────────

async function buildSlide5(offsetX) {
  const frame = makeFrame('05 · Players and coaches', offsetX, 0, W, H, PALETTE.paper);
  makeBrandMark(frame);

  makePill(frame, 'For players and coaches', 48, 48, PALETTE.accent, 0.12, PALETTE.accent, PALETTE.deep);

  const hf = headlineFont();
  makeText(frame, 'Built for development on both sides of the session.', 48, 130, 460, 68, 'Bold', PALETTE.ink, 0.96, -5, hf);
  makeText(frame, 'Close with two audience stories, three principle cards, and a CTA.', 48, 350, 440, 26, 'Regular', PALETTE.muted, 1.5);

  // audience panel
  const ap = makeFrame('Audience panel', 548, 48, 484, 1252, null);
  ap.fills = [{ type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { ...PALETTE.white, a: 0.92 } },
      { position: 1, color: { ...PALETTE.paper2, a: 0.98 } },
    ],
  }];
  ap.cornerRadius = 28;
  ap.strokes = [{ type: 'SOLID', color: PALETTE.deep, opacity: 0.12 }]; ap.strokeWeight = 1;
  frame.appendChild(ap);

  // audience cards
  const audiences = [
    {
      role: 'Players', headline: 'See your movement clearly',
      items: ['Understand technique faster', 'Track growth across sessions', 'Build confidence with visible progress'],
    },
    {
      role: 'Coaches', headline: 'Turn feedback into action',
      items: ['Spot patterns at a glance', 'Guide players with clearer evidence', 'Keep development measurable'],
    },
  ];
  let ax = 20;
  for (const a of audiences) {
    const ac = makeCard(ap, `Audience / ${a.role}`, ax, 20, 222, 440, PALETTE.white, 0.78, 24);
    makeText(ac, a.role.toUpperCase(), 22, 22, 178, 13, 'Extra Bold', PALETTE.accent, 1.4, 10);
    makeText(ac, a.headline, 22, 50, 178, 28, 'Bold', PALETTE.deep, 1.2);
    let ly = 110;
    for (const item of a.items) {
      makeText(ac, `• ${item}`, 22, ly, 178, 18, 'Regular', PALETTE.muted, 1.45);
      ly += 36;
    }
    ax += 242;
  }

  // principle cards
  const principles = [
    { label: 'Format', value: 'Premium + approachable', body: 'Modern sports-tech without losing warmth.' },
    { label: 'Visual rule', value: 'One main message', body: 'Each slide does one job and does it clearly.' },
    { label: 'Finish', value: 'Edge offer lead-in', body: 'End with the offer and a session CTA.' },
  ];
  let px3 = 20;
  for (const p of principles) {
    const pc = makeCard(ap, `Principle / ${p.label}`, px3, 480, 135, 180, PALETTE.white, 0.96, 20);
    makeText(pc, p.label.toUpperCase(), 14, 14, 107, 11, 'Extra Bold', PALETTE.accent, 1.4, 10);
    makeText(pc, p.value, 14, 38, 107, 22, 'Bold', PALETTE.ink, 1.1);
    makeText(pc, p.body, 14, 82, 107, 15, 'Regular', PALETTE.muted, 1.45);
    px3 += 151;
  }

  // CTA button
  const cta = makeRect('CTA / Book an Edge session', 20, 1100, 444, 82, [], 999);
  cta.fills = [{ type: 'GRADIENT_LINEAR',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { ...PALETTE.deep, a: 1 } },
      { position: 1, color: { ...PALETTE.mid, a: 1 } },
    ],
  }];
  ap.appendChild(cta);
  makeText(ap, 'Book an Edge session', 20 + 80, 1115, 284, 26, 'Extra Bold', PALETTE.white, 1.3);

  return frame;
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  figma.notify('Building PoseTek × Edge carousel…');
  await preloadFonts();

  const slides = await Promise.all([
    buildSlide1(0 * (W + GAP)),
    buildSlide2(1 * (W + GAP)),
    buildSlide3(2 * (W + GAP)),
    buildSlide4(3 * (W + GAP)),
    buildSlide5(4 * (W + GAP)),
  ]);

  // Select all and zoom to fit
  figma.currentPage.selection = slides;
  figma.viewport.scrollAndZoomIntoView(slides);
  figma.notify('✅ 5 slides built — all layers are editable!');
  figma.closePlugin();
})();
