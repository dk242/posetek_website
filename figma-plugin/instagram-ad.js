// PoseTek x Edge — Instagram Ad (1080 x 1350)  v3
// KEY MESSAGE: "With every Edge session, get PoseTek for free"
// THEME: Maroon · White · Black  |  Headline font: Anton (condensed display)
// TWO IMAGE SLOTS:
//   "Image zone A / Kid kicking (replace with PNG)"       — left panel (large)
//   "Image zone B / PoseTek app screenshot (replace with PNG)" — right panel
//
// Run: Plugins → Development → PoseTek — Instagram Ad

// --- Palette ------------------------------------------------------------------
const P = {
  maroon:     { r: 0.455, g: 0.098, b: 0.271 }, // #741846 — purple-maroon
  maroonDeep: { r: 0.278, g: 0.043, b: 0.176 }, // #470B2D — deep purple-maroon
  maroonMid:  { r: 0.573, g: 0.122, b: 0.337 }, // #921F56 — mid purple-maroon
  maroonSoft: { r: 0.949, g: 0.843, b: 0.918 }, // #F2D7EA maroon-tinted pink
  black:      { r: 0.031, g: 0.016, b: 0.024 }, // #080408 — near-black, no grey cast
  darkBg:     { r: 0.055, g: 0.024, b: 0.039 }, // #0E0609 — maroon-tinted dark bg
  darkBg2:    { r: 0.090, g: 0.039, b: 0.063 }, // #170A10 — maroon-tinted card bg
  white:      { r: 1,     g: 1,     b: 1     },
  offWhite:   { r: 0.980, g: 0.957, b: 0.969 }, // #FAF4F7 — warm off-white
};

const W   = 1080;
const H   = 1350;
const PAD = 52;

// Font cascade: Anton (EDGE-style condensed block) > Bebas Neue > Poppins > Inter
var DISPLAY_FONT  = 'Inter';
var DISPLAY_STYLE = 'Extra Bold';

// --- Helpers ------------------------------------------------------------------
const solid  = function(c)    { return [{ type: 'SOLID', color: c }]; };
const solidA = function(c, a) { return [{ type: 'SOLID', color: c, opacity: a }]; };

async function loadFonts() {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular'    }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium'     }),
    figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold'  }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold'       }),
    figma.loadFontAsync({ family: 'Inter', style: 'Extra Bold' }),
  ]);
  var candidates = [
    { family: 'Anton',      style: 'Regular'    },
    { family: 'Bebas Neue', style: 'Regular'    },
    { family: 'Poppins',    style: 'Extra Bold' },
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      await figma.loadFontAsync(candidates[i]);
      DISPLAY_FONT  = candidates[i].family;
      DISPLAY_STYLE = candidates[i].style;
      break;
    } catch (_) {}
  }
}

function mkFrame(name, x, y, w, h, bg) {
  var f = figma.createFrame();
  f.name = name; f.resize(w, h); f.x = x; f.y = y;
  f.fills = bg ? solid(bg) : [];
  f.clipsContent = true;
  return f;
}

function mkRect(name, x, y, w, h, fills, radius) {
  radius = radius || 0;
  var r = figma.createRectangle();
  r.name = name; r.x = x; r.y = y; r.resize(w, h);
  r.fills = fills; r.cornerRadius = radius;
  return r;
}

function mkText(parent, content, x, y, w, size, style, family, color, lhMult, lsPct, alignH) {
  lhMult = lhMult || 1.4;
  lsPct  = lsPct  || 0;
  family = family || 'Inter';
  alignH = alignH || 'LEFT';
  var t = figma.createText();
  t.name = content.slice(0, 50);
  t.x = x; t.y = y; t.resize(w, 10);
  t.textAutoResize = 'HEIGHT';
  t.fontName = { family: family, style: style };
  t.fontSize = size;
  t.fills = solid(color);
  t.lineHeight = { value: lhMult * size, unit: 'PIXELS' };
  if (lsPct) t.letterSpacing = { value: lsPct, unit: 'PERCENT' };
  t.textAlignHorizontal = alignH;
  t.characters = content;
  if (parent) parent.appendChild(t);
  return t;
}

function mkTC(parent, content, x, y, w, size, style, family, color, lhMult, lsPct) {
  return mkText(parent, content, x, y, w, size, style, family, color, lhMult, lsPct, 'CENTER');
}

// --- Build --------------------------------------------------------------------
async function buildAd() {

  // Root frame — deep black
  var ad = mkFrame('PoseTek x Edge — Instagram Ad (1080x1350)', 0, 0, W, H, P.darkBg);

  // Subtle maroon glow orbs
  ad.appendChild(mkRect('Bg/orb-bl', -80, H - 360, 360, 360, solidA(P.maroon,    0.14), 999));
  ad.appendChild(mkRect('Bg/orb-tr', W - 220, -80,  300, 300, solidA(P.maroonMid, 0.10), 999));

  // 8px maroon accent bar top
  ad.appendChild(mkRect('Accent/bar-top', 0, 0, W, 8, solid(P.maroon)));

  // Thin white rule under header
  ad.appendChild(mkRect('Rule/header-bottom', PAD, 92, W - PAD * 2, 1, solidA(P.white, 0.10)));

  // --- Header ------------------------------------------------------------------
  // POSETEK wordmark
  var wm = figma.createText();
  wm.name = 'Wordmark/POSETEK';
  wm.x = PAD; wm.y = 20;
  wm.resize(300, 10); wm.textAutoResize = 'WIDTH_AND_HEIGHT';
  wm.fontName = { family: DISPLAY_FONT, style: DISPLAY_STYLE };
  wm.fontSize = 38; wm.fills = solid(P.white);
  wm.letterSpacing = { value: 2, unit: 'PERCENT' };
  wm.characters = 'POSETEK';
  ad.appendChild(wm);

  // x EDGE — maroon
  var xe = figma.createText();
  xe.name = 'Label/xEDGE';
  xe.x = PAD + 168; xe.y = 26;
  xe.resize(140, 10); xe.textAutoResize = 'WIDTH_AND_HEIGHT';
  xe.fontName = { family: DISPLAY_FONT, style: DISPLAY_STYLE };
  xe.fontSize = 30; xe.fills = solid(P.maroon);
  xe.letterSpacing = { value: 2, unit: 'PERCENT' };
  xe.characters = '\u00D7 EDGE';
  ad.appendChild(xe);

  // FREE badge
  var badge = mkFrame('Badge/FREE', W - PAD - 120, 18, 120, 52, null);
  badge.cornerRadius = 999;
  badge.fills = solid(P.maroon);
  ad.appendChild(badge);
  var bT = figma.createText();
  bT.name = 'Badge/FREE-text';
  bT.x = 0; bT.y = 0; bT.resize(120, 52); bT.textAutoResize = 'NONE';
  bT.fontName = { family: DISPLAY_FONT, style: DISPLAY_STYLE };
  bT.fontSize = 22; bT.fills = solid(P.white);
  bT.textAlignHorizontal = 'CENTER'; bT.textAlignVertical = 'CENTER';
  bT.letterSpacing = { value: 4, unit: 'PERCENT' };
  bT.characters = 'FREE';
  badge.appendChild(bT);

  // --- Two image zones (y 108, h=620) ------------------------------------------
  var IY   = 108;
  var IH   = 620;
  var IGAP = 14;
  var IW_A = 524;
  var IW_B = W - PAD * 2 - IW_A - IGAP;

  // Zone A — kid kicking soccer ball
  var zA = mkFrame('Image zone A / Kid kicking (replace with PNG)', PAD, IY, IW_A, IH, null);
  zA.cornerRadius = 20;
  zA.fills = solid(P.darkBg2);
  var hA = mkRect('Hint/border', 0, 0, IW_A, IH, solidA(P.maroon, 0.05), 20);
  hA.strokes = [{ type: 'SOLID', color: P.maroon, opacity: 0.35 }];
  hA.strokeWeight = 2;
  zA.appendChild(hA);
  mkTC(zA, '[ Player photo ]',          0, IH/2 - 58, IW_A, 14, 'Bold',    'Inter', P.maroon,     1.4, 0);
  mkTC(zA, 'Kid kicking a soccer ball', 0, IH/2 - 30, IW_A, 16, 'Regular', 'Inter', P.white,      1.5, 0);
  mkTC(zA, 'Drop PNG here to replace',  0, IH/2 + 14, IW_A, 13, 'Regular', 'Inter', P.maroonSoft, 1.4, 0);
  var fA = mkRect('Overlay/fade', 0, IH - 150, IW_A, 150, []);
  fA.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: P.darkBg.r, g: P.darkBg.g, b: P.darkBg.b, a: 0   } },
      { position: 1, color: { r: P.darkBg.r, g: P.darkBg.g, b: P.darkBg.b, a: 0.9 } },
    ],
  }];
  zA.appendChild(fA);
  mkText(zA, 'THE ACTION', 22, IH - 46, IW_A - 44, 11, 'Extra Bold', 'Inter', P.maroon, 1.4, 12);
  ad.appendChild(zA);

  // Zone B — PoseTek app screenshot
  var zB = mkFrame('Image zone B / PoseTek app screenshot (replace with PNG)', PAD + IW_A + IGAP, IY, IW_B, IH, null);
  zB.cornerRadius = 20;
  zB.fills = solid(P.black);
  var hB = mkRect('Hint/border', 0, 0, IW_B, IH, solidA(P.maroon, 0.04), 20);
  hB.strokes = [{ type: 'SOLID', color: P.maroon, opacity: 0.22 }];
  hB.strokeWeight = 2;
  zB.appendChild(hB);
  mkTC(zB, '[ App screenshot ]',       0, IH/2 - 58, IW_B, 14, 'Bold',    'Inter', P.maroonSoft, 1.4, 0);
  mkTC(zB, 'PoseTek app UI',           0, IH/2 - 30, IW_B, 16, 'Regular', 'Inter', P.white,      1.5, 0);
  mkTC(zB, 'Drop PNG here to replace', 0, IH/2 + 14, IW_B, 13, 'Regular', 'Inter', P.maroonSoft, 1.4, 0);
  var fB = mkRect('Overlay/fade', 0, IH - 150, IW_B, 150, []);
  fB.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: P.black.r, g: P.black.g, b: P.black.b, a: 0   } },
      { position: 1, color: { r: P.black.r, g: P.black.g, b: P.black.b, a: 0.9 } },
    ],
  }];
  zB.appendChild(fB);
  mkText(zB, 'THE PLATFORM', 16, IH - 46, IW_B - 32, 11, 'Extra Bold', 'Inter', P.maroon, 1.4, 12);
  ad.appendChild(zB);

  // Short maroon rule divider
  ad.appendChild(mkRect('Rule/section-divider', PAD, 748, 60, 4, solid(P.maroon), 2));

  // --- Offer copy section ------------------------------------------------------

  // Eyebrow
  mkText(ad, "WHAT'S INCLUDED WITH EVERY EDGE SESSION", PAD, 764, W - PAD * 2, 13, 'Extra Bold', 'Inter', P.maroonSoft, 1.4, 14);

  // Big white headline
  var hl1 = figma.createText();
  hl1.name = 'Headline/WITH EVERY EDGE SESSION';
  hl1.x = PAD; hl1.y = 792;
  hl1.resize(W - PAD * 2, 10); hl1.textAutoResize = 'HEIGHT';
  hl1.fontName = { family: DISPLAY_FONT, style: DISPLAY_STYLE };
  hl1.fontSize = 96; hl1.fills = solid(P.white);
  hl1.lineHeight = { value: 96 * 0.92, unit: 'PIXELS' };
  hl1.letterSpacing = { value: 1, unit: 'PERCENT' };
  hl1.characters = 'WITH EVERY\nEDGE SESSION';
  ad.appendChild(hl1);

  // Maroon offer line
  var hl2 = figma.createText();
  hl2.name = 'Headline/GET POSETEK FREE';
  hl2.x = PAD; hl2.y = 990;
  hl2.resize(W - PAD * 2, 10); hl2.textAutoResize = 'HEIGHT';
  hl2.fontName = { family: DISPLAY_FONT, style: DISPLAY_STYLE };
  hl2.fontSize = 72; hl2.fills = solid(P.maroon);
  hl2.lineHeight = { value: 72 * 0.94, unit: 'PIXELS' };
  hl2.letterSpacing = { value: 1, unit: 'PERCENT' };
  hl2.characters = 'GET POSETEK FREE';
  ad.appendChild(hl2);

  // Underline bar
  ad.appendChild(mkRect('Accent/underline', PAD, 1058, 320, 5, solid(P.maroon), 3));

  // Body copy
  mkText(ad,
    'Premium kick, sprint & jump analysis — included at no extra cost with every Edge training session.',
    PAD, 1074, W - PAD * 2, 21, 'Regular', 'Inter', P.offWhite, 1.7, 0);

  // Feature pills
  var pillLabels = ['Kick Analysis', 'Sprint Tracking', 'Jump Power'];
  var px = PAD;
  for (var i = 0; i < pillLabels.length; i++) {
    var lbl = pillLabels[i];
    var pw  = lbl.length * 11 + 44;
    var fp  = mkRect('Pill/' + lbl, px, 1170, pw, 44, solidA(P.maroon, 0.15), 999);
    fp.strokes = [{ type: 'SOLID', color: P.maroon, opacity: 0.45 }];
    fp.strokeWeight = 1;
    ad.appendChild(fp);
    mkText(ad, lbl, px + 22, 1170 + 14, pw - 44, 13, 'Semi Bold', 'Inter', P.maroonSoft, 1.3, 0);
    px += pw + 12;
  }

  // CTA button
  var cta = mkRect('CTA/Book an Edge session', PAD, 1236, W - PAD * 2, 72, [], 999);
  cta.fills = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { r: P.maroonDeep.r, g: P.maroonDeep.g, b: P.maroonDeep.b, a: 1 } },
      { position: 1, color: { r: P.maroon.r,     g: P.maroon.g,     b: P.maroon.b,     a: 1 } },
    ],
  }];
  cta.strokes = [{ type: 'SOLID', color: P.maroon, opacity: 0.55 }];
  cta.strokeWeight = 1.5;
  ad.appendChild(cta);

  var ctaT = figma.createText();
  ctaT.name = 'CTA/text';
  ctaT.x = PAD; ctaT.y = 1236;
  ctaT.resize(W - PAD * 2, 72); ctaT.textAutoResize = 'NONE';
  ctaT.fontName = { family: DISPLAY_FONT, style: DISPLAY_STYLE };
  ctaT.fontSize = 26; ctaT.fills = solid(P.white);
  ctaT.textAlignHorizontal = 'CENTER'; ctaT.textAlignVertical = 'CENTER';
  ctaT.letterSpacing = { value: 2, unit: 'PERCENT' };
  ctaT.characters = 'BOOK AN EDGE SESSION  \u2192';
  ad.appendChild(ctaT);

  // Footer
  var ft = figma.createText();
  ft.name = 'Footer/POSETEK.COM';
  ft.x = PAD; ft.y = 1322;
  ft.resize(W - PAD * 2, 10); ft.textAutoResize = 'HEIGHT';
  ft.fontName = { family: 'Inter', style: 'Medium' };
  ft.fontSize = 14; ft.fills = solidA(P.white, 0.25);
  ft.textAlignHorizontal = 'CENTER';
  ft.letterSpacing = { value: 6, unit: 'PERCENT' };
  ft.characters = 'POSETEK.COM';
  ad.appendChild(ft);

  return ad;
}

// --- Entry point --------------------------------------------------------------
(async () => {
  figma.notify('Building PoseTek x Edge Instagram Ad...');
  // Remove ALL previously generated frames (carousel slides, v1/v2/v3 ads)
  // so no old green or off-colour frames remain behind the new one.
  var staleNames = [
    'PoseTek',      // catches "PoseTek x Edge...", "PoseTek — Instagram Ad..."
    '01 · ',        // carousel slides from the original plugin
    '02 · ',
    '03 · ',
    '04 · ',
    '05 · ',
  ];
  var stale = figma.currentPage.findAll(function(n) {
    if (n.type !== 'FRAME') return false;
    for (var s = 0; s < staleNames.length; s++) {
      if (n.name.indexOf(staleNames[s]) === 0) return true;
    }
    return false;
  });
  stale.forEach(function(n) { n.remove(); });
  await loadFonts();
  figma.notify('Font: ' + DISPLAY_FONT);
  var ad = await buildAd();
  figma.currentPage.selection = [ad];
  figma.viewport.scrollAndZoomIntoView([ad]);
  figma.notify('Ad built! Drop your 2 PNGs into the image zones.');
  figma.closePlugin();
})();
