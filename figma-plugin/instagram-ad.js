// PoseTek — Instagram Ad (1080 × 1350) Figma Plugin
// Generates a single production-ready Instagram feed ad frame on the current canvas.
// Run via: Plugins → Development → Open Console, paste this file, or load as a dev plugin.
//
// AFTER RUNNING:
//   1. Replace the green placeholder zones with real player / app-screen images.
//   2. Swap any copy wrapped in «angle quotes» with final approved text.
//   3. Adjust the headline weight if Poppins is unavailable — Inter Bold is the fallback.

// ─── Palette ────────────────────────────────────────────────────────────────

const P = {
  deepGreen:   { r: 0.102, g: 0.227, b: 0.180 }, // #1A3A2E  — primary brand dark
  midGreen:    { r: 0.176, g: 0.369, b: 0.290 }, // #2D5E4A  — secondary
  accent:      { r: 0.298, g: 0.549, b: 0.416 }, // #4C8C6A  — accent green
  accentSoft:  { r: 0.859, g: 0.925, b: 0.882 }, // #DBECE2  — tinted bg
  paper:       { r: 0.969, g: 0.973, b: 0.965 }, // #F7F8F6  — off-white
  paper2:      { r: 0.929, g: 0.957, b: 0.937 }, // #EDF4EF
  ink:         { r: 0.067, g: 0.098, b: 0.082 }, // #111918  — near-black text
  muted:       { r: 0.373, g: 0.427, b: 0.400 }, // #5F6D66  — secondary text
  white:       { r: 1,     g: 1,     b: 1     },
  black:       { r: 0,     g: 0,     b: 0     },
  darkBg:      { r: 0.051, g: 0.122, b: 0.094 }, // #0D1F18  — hero dark bg
  darkBg2:     { r: 0.090, g: 0.192, b: 0.149 }, // #173126
};

// ─── Canvas dimensions ───────────────────────────────────────────────────────

const W = 1080;  // 1080 px wide
const H = 1350;  // 1350 px tall  (4:5 portrait — standard IG feed ad)

// ─── Utilities ───────────────────────────────────────────────────────────────

const solid = c => [{ type: 'SOLID', color: c }];
const solidA = (c, a) => [{ type: 'SOLID', color: c, opacity: a }];

async function loadFont(family, style) {
  await figma.loadFontAsync({ family, style });
}

async function preloadFonts() {
  await Promise.all([
    loadFont('Inter', 'Regular'),
    loadFont('Inter', 'Medium'),
    loadFont('Inter', 'Semi Bold'),
    loadFont('Inter', 'Bold'),
    loadFont('Inter', 'Extra Bold'),
  ]);
  try { await loadFont('Poppins', 'Bold'); } catch (_) {}
  try { await loadFont('Poppins', 'Extra Bold'); } catch (_) {}
}

function headlineFamily() {
  // Poppins is bolder and more athletic — use if available, else fall back
  try { return 'Poppins'; } catch (_) { return 'Inter'; }
}

// Build a bare Frame
function frame(name, x, y, w, h, bg) {
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  f.x = x; f.y = y;
  f.fills = bg ? solid(bg) : [];
  f.cornerRadius = 0;
  f.clipsContent = true;
  return f;
}

// Rectangle helper
function rect(name, x, y, w, h, fills, radius = 0) {
  const r = figma.createRectangle();
  r.name = name;
  r.x = x; r.y = y;
  r.resize(w, h);
  r.fills = fills;
  r.cornerRadius = radius;
  return r;
}

// Text helper — auto-height
function text(parent, content, x, y, w, size, style, color, lineHeightMult = 1.4, letterSpacingPct = 0, family = 'Inter') {
  const t = figma.createText();
  t.name = content.slice(0, 50);
  t.x = x; t.y = y;
  t.resize(w, 10);
  t.textAutoResize = 'HEIGHT';
  t.fontName = { family, style };
  t.fontSize = size;
  t.fills = solid(color);
  t.lineHeight = { value: lineHeightMult * size, unit: 'PIXELS' };
  if (letterSpacingPct) t.letterSpacing = { value: letterSpacingPct, unit: 'PERCENT' };
  t.characters = content;
  if (parent) parent.appendChild(t);
  return t;
}

// Pill / tag badge
function pill(parent, label, x, y, bgColor, bgOpacity, borderColor, textColor) {
  const p = figma.createFrame();
  p.name = `Tag / ${label}`;
  p.layoutMode = 'HORIZONTAL';
  p.primaryAxisSizingMode = 'AUTO';
  p.counterAxisSizingMode = 'AUTO';
  p.paddingLeft = 20; p.paddingRight = 20;
  p.paddingTop = 13; p.paddingBottom = 13;
  p.itemSpacing = 10;
  p.cornerRadius = 999;
  p.fills = solidA(bgColor, bgOpacity);
  p.strokes = [{ type: 'SOLID', color: borderColor, opacity: 0.28 }];
  p.strokeWeight = 1.5;
  p.x = x; p.y = y;

  const dot = figma.createEllipse();
  dot.name = 'dot';
  dot.resize(9, 9);
  dot.fills = solid(P.accent);
  p.appendChild(dot);

  const t = figma.createText();
  t.name = 'label';
  t.fontName = { family: 'Inter', style: 'Bold' };
  t.fontSize = 15;
  t.fills = solid(textColor);
  t.letterSpacing = { value: 6, unit: 'PERCENT' };
  t.characters = label.toUpperCase();
  p.appendChild(t);

  if (parent) parent.appendChild(p);
  return p;
}

// ─── Build the Instagram Ad ──────────────────────────────────────────────────

async function buildInstagramAd() {

  // ── Root frame ───────────────────────────────────────────────────────────
  const ad = frame('PoseTek — Instagram Ad (1080×1350)', 0, 0, W, H, P.darkBg);

  // ── Background depth — subtle radial orb, bottom-left ────────────────────
  const orb = rect('Bg / orb', -100, H - 120 - 440, 440, 440, solidA(P.accent, 0.12), 999);
  ad.appendChild(orb);

  // Soft gradient accent — top right glow
  const topGlow = rect('Bg / top-right glow', W - 320, -60, 340, 340, [], 999);
  topGlow.fills = [{
    type: 'GRADIENT_RADIAL',
    gradientTransform: [[0.5, 0, 0.5], [0, 0.5, 0.5]],
    gradientStops: [
      { position: 0, color: { ...P.midGreen, a: 0.55 } },
      { position: 1, color: { ...P.darkBg,   a: 0    } },
    ],
  }];
  ad.appendChild(topGlow);

  // ── Thin accent bar — top edge ────────────────────────────────────────────
  const topBar = rect('Accent / top bar', 0, 0, W, 6, solid(P.accent));
  ad.appendChild(topBar);

  // ── Header row (y ≈ 50–100) ───────────────────────────────────────────────
  // Wordmark — PoseTek
  const wm = figma.createText();
  wm.name = 'Wordmark / PoseTek';
  wm.x = 52; wm.y = 52;
  wm.resize(160, 10);
  wm.textAutoResize = 'WIDTH_AND_HEIGHT';
  wm.fontName = { family: 'Inter', style: 'Extra Bold' };
  wm.fontSize = 30;
  wm.fills = solid(P.white);
  wm.letterSpacing = { value: -3, unit: 'PERCENT' };
  wm.characters = 'PoseTek';
  ad.appendChild(wm);

  // "Soccer Performance Analytics" eyebrow pill — right-aligned
  pill(ad, 'Free with Edge', W - 52 - 220, 48, P.accent, 0.18, P.white, P.white);

  // ── Hero image zone (full width, y 128–800) ──────────────────────────────
  const imgZone = frame('Image zone / Player action (replace with PNG)', 0, 128, W, 672, null);
  imgZone.fills = solidA(P.deepGreen, 0.85);
  imgZone.clipsContent = true;

  // Dashed-border hint rectangle inside the zone
  const imgHint = rect('↑ Drop player PNG here', 40, 60, W - 80, 560, solidA(P.accent, 0.10), 24);
  imgHint.strokes = [{ type: 'SOLID', color: P.accent, opacity: 0.35 }];
  imgHint.strokeWeight = 2;
  imgZone.appendChild(imgHint);

  text(imgZone, '⬆  Replace with player action PNG', 40 + 24, 60 + 240, W - 80 - 48, 20, 'Bold', P.white, 1.4, 0);
  text(imgZone, 'Keep subject large — ball / kick / sprint moment.\nUse a bright, high-contrast photo for best ad performance.', 40 + 24, 60 + 280, W - 80 - 48, 16, 'Regular', P.accent, 1.55, 0);

  // Gradient overlay — fade image into dark at the bottom
  const imgOverlay = rect('Image overlay / bottom fade', 0, 672 - 280, W, 280, []);
  imgOverlay.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { ...P.darkBg, a: 0 } },
      { position: 1, color: { ...P.darkBg, a: 1 } },
    ],
  }];
  imgZone.appendChild(imgOverlay);

  // Overlay label — "ANALYZE · TRACK · IMPROVE" inside image zone at bottom
  text(imgZone, 'ANALYZE  ·  TRACK  ·  IMPROVE', 52, 672 - 76, W - 104, 18, 'Extra Bold', P.accent, 1.4, 10);

  ad.appendChild(imgZone);

  // ── Stats strip (y 820–940) ───────────────────────────────────────────────
  const statsY = 836;
  const statItems = [
    { label: 'Kick Analysis',  icon: '⚽' },
    { label: 'Sprint Tracking', icon: '⚡' },
    { label: 'Jump Power',     icon: '📈' },
  ];
  const statW = (W - 104 - 2 * 20) / 3;  // 3 equal columns with gaps

  statItems.forEach((s, i) => {
    const sx = 52 + i * (statW + 20);
    const card = rect(`Stat / ${s.label}`, sx, statsY, statW, 100, solidA(P.white, 0.07), 16);
    card.strokes = [{ type: 'SOLID', color: P.white, opacity: 0.10 }];
    card.strokeWeight = 1;
    ad.appendChild(card);

    text(ad, s.icon, sx + 18, statsY + 14, 40, 22, 'Regular', P.white, 1.2);
    text(ad, s.label, sx + 18, statsY + 50, statW - 36, 17, 'Bold', P.white, 1.25);
  });

  // ── Headline area (y 970–1140) ────────────────────────────────────────────
  const hf = headlineFamily();

  text(ad, 'See every rep.\nFeel every gain.', 52, 966, W - 104, 98, 'Bold', P.white, 0.97, -3, hf);
  text(ad, 'PoseTek gives you premium soccer performance analytics — kick mechanics, sprint data, and jump power — in one clean, easy-to-understand platform.', 52, 1168, W - 104, 26, 'Regular', P.accentSoft, 1.65);

  // ── Feature pills row (y 1220–1278) ──────────────────────────────────────
  const featureLabels = ['Clean UI', 'Player-led', 'Coach-friendly'];
  let fpx = 52;
  for (const fl of featureLabels) {
    const fpW = fl.length * 13 + 44;
    const fp = rect(`Feature pill / ${fl}`, fpx, 1220, fpW, 50, solidA(P.white, 0.09), 999);
    fp.strokes = [{ type: 'SOLID', color: P.accent, opacity: 0.30 }];
    fp.strokeWeight = 1;
    ad.appendChild(fp);
    text(ad, fl, fpx + 22, 1220 + 14, fpW - 44, 16, 'Semi Bold', P.accent, 1.4);
    fpx += fpW + 14;
  }

  // ── CTA button (y 1290–1390) ──────────────────────────────────────────────
  // Full-width gradient button
  const cta = rect('CTA / Book a free Edge session →', 52, 1290, W - 104, 76, [], 999);
  cta.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { ...P.deepGreen, a: 1 } },
      { position: 1, color: { ...P.accent,    a: 1 } },
    ],
  }];
  cta.strokes = [{ type: 'SOLID', color: P.accent, opacity: 0.35 }];
  cta.strokeWeight = 1.5;
  ad.appendChild(cta);

  text(ad, 'Book a free Edge session  →', 52 + 80, 1290 + 22, W - 104 - 160, 28, 'Extra Bold', P.white, 1.35, 0, 'Inter');

  // ── Footer — URL (y 1388–1420) ────────────────────────────────────────────
  const footerText = figma.createText();
  footerText.name = 'Footer / posetek.com';
  footerText.resize(W - 104, 10);
  footerText.textAutoResize = 'HEIGHT';
  footerText.x = 52; footerText.y = 1392;
  footerText.fontName = { family: 'Inter', style: 'Medium' };
  footerText.fontSize = 16;
  footerText.fills = solidA(P.white, 0.35);
  footerText.textAlignHorizontal = 'CENTER';
  footerText.letterSpacing = { value: 5, unit: 'PERCENT' };
  footerText.characters = 'posetek.com';
  ad.appendChild(footerText);

  return ad;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

(async () => {
  figma.notify('Building PoseTek Instagram Ad…');
  await preloadFonts();

  const ad = await buildInstagramAd();

  figma.currentPage.selection = [ad];
  figma.viewport.scrollAndZoomIntoView([ad]);
  figma.notify('✅ Instagram Ad built — 1080×1350, all layers editable!');
  figma.closePlugin();
})();
