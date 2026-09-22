# Coaching V3 and Investor V1 production â€” September 22, 2026

The user approved implementation and email delivery of two films: the 52-second
vertical coaching revision and a separate 90-second landscape investor introduction.
Existing V1/V2 exports and V2 composition source are preserved. No website,
application data, training catalog or deployment was changed.

## Editorial changes

Coaching V3 reduces the assessment section from eight to five seconds. All six
source recordings begin together at their own frame rates; containers form at
6.7â€“7.2 seconds and the club transition centers on 9 seconds. Subsequent scenes
shift three seconds earlier. The closing says **Start with evidence. Train what's
next.** and retains the coach-page URL, without the previous sales line.

Investor V1 uses a purpose-built landscape composition, with the same fonts,
palette, recorded movement data, approved drill footage and illustrative player.
Its sequence is opportunity (0â€“8), mission (8â€“17), tests (17â€“22), club/player
(22â€“27), guided session (27â€“33), retest cycle (33â€“43), first partnership (43â€“54),
business model (54â€“64), expansion strategy (64â€“75), investment purpose (75â€“84)
and brand close (84â€“90). No monetary amounts, projections, pricing, SAFE terms,
unsigned partner logos or private player data are included.

The deck's mission and club-serving ethos are the narrative source. Source/claim
boundaries and map provenance are in [INVESTOR_SOURCE_NOTES.md](INVESTOR_SOURCE_NOTES.md).
Two small narration edits retain the meaning while fitting natural delivery:
'Yet youth clubs often lack the individual evidence used at elite academies' and
'Our mission: make elite-level analysis accessible through phone-based testing,
individual insight, and purposeful training.' Product narration is separately
aligned to the three product sub-scenes. The planned player subscription and
expansion strategy retain explicit labels.

## Production workflow and validation

The render CLI selects `v2`, `v3` or `investor`; V2 remains the default. Audio
scripts accept an optional script filename and isolate intermediate work/output
per edition. Rendering uses local fonts, muted approved footage, deterministic
pose geometry and local neural narration with an original 106 BPM score.

Style-frame review checks every scene, readability, caption clearance and
source/claim consistency. Independent visual review caught and resolved a
mismatched demonstration in the phone-to-pose sequence and a too-small sample-data
label in the investor dashboard. The 11-second coaching proof and 27-second investor proof precede the full-resolution exports.
Both use the prepared high-resolution originals recorded in the asset receipt,
not the website derivative fallback.
Generated files, the private PDF, reference captures, dependencies and delivery
links are excluded from Git. Source typechecking passes. The coach mix has 22 caption cues and the investor
mix 32, with exact 52/90-second audio sample counts. Investor transcription
agreement is 99.45%; the only recognition difference is Tech/techs. Automated transcription,
caption timing, loudness and full media decoding are checked; no direct listening
review is claimed.

## Coaching V3 verified export

| Property | Value |
| --- | --- |
| Master | `output/v3/PoseTek-Coaches-V3.mp4` |
| Picture | 1080 Ã— 1920, H.264, 30fps, 1,560 decoded frames |
| Picture / container | 52.000 / 52.053333 seconds |
| Audio | Stereo AAC, 48kHz; -16.00 LUFS, -2.51 dBTP |
| Master bytes | 15,059,591 |
| SHA-256 | `23d5edbe82d55c0801634a5d106bc73fb8115cebce7ccb221c87ba0d9f02a865` |
| Email preview | 540 Ã— 960; 2,880,604 bytes |

Master and email preview decode end-to-end without errors. The 11-second proof
covers the shortened test-to-club transition and the revised closing. The master
upload was verified by metadata readback, including exact byte size.

## Investor V1 verified export

| Property | Value |
| --- | --- |
| Master | `output/investor/PoseTek-Investor-V1.mp4` |
| Picture | 1920 × 1080, H.264, 30fps, 2,700 decoded frames |
| Picture / container | 90.000 / 90.048000 seconds |
| Audio | Stereo AAC, 48kHz; -15.97 LUFS, -2.32 dBTP |
| Master bytes | 11,266,984 |
| SHA-256 | `ac2b7b5bc6b147d0f8ab7c39e2ac76ef7f508f9db587cf358f2942632cae0225` |
| Email preview | 960 × 540; 2,932,370 bytes |

Master and email preview decode end-to-end without errors. Final-master contact
frames and the compressed preview were inspected. The private Drive upload was
verified by metadata readback, including exact byte size.

## Delivery

Outlook accepted two emails to the user: **PoseTek coaching video V3 — tighter
pacing and new closing** and **PoseTek investor video V1 — 90-second introduction**.
Each includes its compact MP4 attachment and full-resolution private Drive link,
with instructions to open the link through the user's existing Google account.
No videos were sent to investors or other recipients, and no public sharing was
created. Both full-resolution files and previews were also copied into the
original workspace's ignored output folders alongside the previous exports.
