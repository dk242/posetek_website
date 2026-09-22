# Investor film: source, claims and visual reference lock

Reviewed September 22, 2026 against repository commit
`be3e80402868f9ec662c674ae68e2df63515884f`. This is a source review for the approved
90-second investor narrative, not a new live-service audit. The September 2026
PoseTek pitch deck supplied by the user was reviewed through active pages 1-18;
pages 19-38 are a parking lot and do not establish current claims. The private
deck and reference captures remain outside Git.

## Narrative and claim boundaries

The approved story is accessible performance analysis, a phone-based assessment
and development cycle, the first club partner, the business model, an explicitly
planned expansion sequence, and how investment would support the next stage.

| Story element | Source and approved treatment |
| --- | --- |
| Mission | Deck p3: make elite-level performance analysis, feedback and individual training more accessible. Present this as PoseTek's mission; do not assert validated equivalence to an elite laboratory or academy. Keep the deck's early-partner ethos: show up, listen and improve the product from feedback. |
| Product | Deck pp4-8 and [project context](../../POSETEK_PROJECT_CONTEXT.md): phone capture of six standardized tests, club/team/player review, guided training and retesting. Say phone-based testing, not that every analysis operation runs entirely on the phone. |
| First partner | Deck p6 identifies Vacaville as the first club partnership; the project context documents delivered testing and club workflows. Use the approved first-partner statement without extrapolating to every club team, complete test coverage, current adoption counts or demonstrated training outcomes. |
| Business model | Deck pp6-7 and p15 describe club testing/platform services and a player subscription. The approved film distinguishes the club service model from the **planned player subscription**. Do not describe projected subscriber adoption as current traction or include prices. |
| Expansion | Deck pp9-11: Bay Area, then New Jersey/Pennsylvania, then broader expansion. Label the sequence **Expansion strategy** and use future-tense narration. Regional names are strategy, not signed customers, current operations or committed rollout dates. |
| Investment | Deck p17 provides a resourcing rationale; the approved narrative focuses on product development, delivery and onboarding. Frame these as what investment would support, not guaranteed milestones. |

Omit monetary amounts, revenue/profit projections, market-size calculations,
fundraising instrument terms and cap/discount placeholders. The film is not an
abridged readout of the financial slides.

Concrete corrections to preserve while adapting the deck:

- Deck p6's complete-coverage language conflicts with documented partial and
  unavailable test results. A first partnership supports the traction story;
  it does not prove every player completed every test.
- The retest cadence on p6 is a planned service sequence, not evidence of a
  completed outcome. Show the recurring development loop without promising a
  fixed cadence to every customer or implying the pictured drill caused a gain.
- Deck p14's claim of recommendations backed by thousands of similar players
  is not substantiated by this source review. The mission and existing reference
  overlays do not establish broad scientific validation or an exclusive dataset.
- Do not carry forward p14's suggestion that leaving means losing player history.
  Present ongoing value through evidence, useful feedback and responsive service;
  do not turn player-data dependence into the company's ethos.
- Club prospects, league networks and national platforms on pp9-10 are not
  partner evidence. Do not create an affiliate-logo wall or invent partnerships.
- The September 21 whole-body expansion contains unpublished exercise drafts and
  a mobile acceptance gate. Do not advertise that expansion as an already
  available, fully approved training library.

## Visual reference lock

Retain the approved V2/website identity and motion language. The investor change
adds business context and time for explanation; it does not call for a rebrand.
The deck's clear type hierarchy and whitespace are useful references, while the
approved film's dark treatment remains the visual authority.

- Palette: deep green `#04130e`, panel green `#0a211a`, lime `#b7f34a`, off-white
  `#f0f5ed`, muted green `#a9bdb1` and fine dividers `#254036`. Keep the current
  PoseTek mark, Barlow Condensed headings, Inter body and IBM Plex Mono labels.
- Reuse [V2 scene behavior](src/RevisionScenes.tsx): six moving test examples,
  containers forming around them, club-to-team-to-player navigation, elapsed
  session time, explicit set completion and the next drill. Add investor scenes
  around that recognizable product explanation.
- Keep recorded landmarks, source aspect ratios, source timing and measurement
  units intact. Camera framing and presentation can change; coordinates, limb
  paths and ball tracking must not be generated, smoothed or morphed into new
  purported evidence. The six-test animation uses recorded movement coordinates;
  it is not six newly filmed test videos.
- The held hero uses estimated depth and an editorial camera orbit, not a
  calibrated body scan. Follow the skeleton-only cleanup in
  [hero provenance](../../app/src/pages/home/latest-hero/PROVENANCE.md), which
  supersedes that document's older anatomical-body sections. Preserve the fine
  lime/mint connections and source ball placement in [PoseVisual](src/PoseVisual.tsx).
- Use the same approved Figure-8 and Wall pass footage with the existing input
  hash checks in [asset preparation](scripts/prepare-assets.mjs) and
  [media provenance](../../app/src/pages/home/product/media/provenance.json).
  Proportional reframing is editorial; replacement or synthesized athlete action
  is not an equivalent source. Disclose a lower-resolution fallback in the render
  receipt instead of silently treating it as the approved high-resolution original.
- Keep Northfield FC and Alex's dashboard visibly illustrative. Present Vacaville
  as a separate real-partner statement; do not relabel the fictional dashboard or
  place it beneath a real-club title in a way that implies actual player records.
  Preserve the product-preview label on the recreated phone and the illustrative
  label on any earlier/latest result comparison.
- Use regional labels or an abstract sequence for expansion. A map or location
  marker must communicate planned reach, not a network of existing customer sites.
  No fictional partner crests, testimonials or new third-party logos.

The expansion outline in [us-map.json](src/us-map.json) is the contiguous-US
subset of Natural Earth's 1:110m country boundaries, sourced from
[`ne_110m_admin_0_countries.geojson`](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson).
Natural Earth places its map data in the public domain, including commercial
reuse and adaptation ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/),
checked September 22, 2026). The film's route and region markers are editorial
indications of expansion strategy, not measured routes or existing club addresses.

Before release, check the rendered captions as well as narration and main titles:
**planned** subscription and **strategy** expansion must survive trimming. Preserve
clear sample labels, stable reading holds and the distinction between actual
recorded motion, illustrative product data and future plans. Reconfirm any new
traction statement against a dated source before adding it.

This review did not access live admin, change athlete data, generate new media,
install tools, deploy the website or verify a new production release.
