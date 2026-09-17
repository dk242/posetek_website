# Two-drill media and AI Coach update — September 16, 2026

## Approved direction and reference lock

The homepage demonstration uses Figure-8 dribble (`DRB-006`) and Wall pass rhythm (`PAS-001`) only. Existing PoseTek emerald surfaces, lime actions, concise labels and section order remain the visual target. Mobile source at `98d8a051f0580785b70610f5c1a29a5246e08bfb`, specifically `DrillMedia.swift` and `DrillMediaPagerView.swift`, supplies approved-media selection, Overview/Demo switching, aspect-fit video and offscreen pausing. Refero craft guidance supplies keyboard focus, readable media and touch-target treatment. No generated product evidence or third-party footage is used.

Desktop places the diagram and video beside one another. Below 760px, and always inside the phone, Overview/Demo selects one readable media area. Playback starts on request and stops when hidden; video failure keeps the diagram usable. Video and diagram are separate teaching references, not synchronized captures. The phone can select either drill and resets its local sample progress on change.

The Figure-8 has balanced mirrored loops and a single crossing, with cones centered inside the loops. The wall-pass player and target share one axis; ball travel is straight out and back. Dribbling and Passing priorities order these two drills while time and energy retain their existing dose rules. Other catalog entries, mobile source and Firebase content are unchanged.

## Media provenance

Only the approved `primaryDemo` assets of the two selected catalog documents are exported. The originals stay in ignored local storage; browser-compatible derivatives and posters are required site assets. See `app/src/pages/home/product/media/provenance.json` for object generations, source/output checksums, dimensions and conversion settings. Public playback uses site assets and requires no Firebase session, private token or rule change.

`node scripts/prepare-homepage-drill-media.cjs --inspect` checks the current approved sources with an existing Firebase CLI login. Without `--inspect`, it prepares local public derivatives using FFmpeg/FFprobe; it never writes to Firebase. Ordinary site builds use the committed derivatives and do not run this preparation step. Figure-8 is 11.98 seconds and 1.67 MB; Wall pass is 2.30 seconds and 0.35 MB. Both are upright 406×720 H.264/AAC MP4 with fast-start metadata and retain their full source framing.

## Coach behavior

Dribbling, Top speed and Sessions cards are keyboard-accessible selection buttons. Cards and existing question chips update the same selected question, coach answer and compact chart. Charts use existing sample values with units and checkpoint labels; Sessions shows the target of four. No dates or athlete results are invented. Full explanations and the workout handoff remain available.

## Release boundary

The player profile, hero poses, six performance recordings, technique analysis and 171-file application/public baseline remain unchanged. Preserve the teammate Firebase rules commit `abf4106`; this homepage release does not deploy rules. Use the guarded production assembly, verify a draft, promote the same artifact, and record the release in `DRILL_VIDEO_COACH_PRODUCTION.json`.
