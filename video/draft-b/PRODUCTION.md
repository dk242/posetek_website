# Draft B production and delivery — September 21, 2026

The user authorized rendering the proposed club/coach film and sending it to their
email. Production and delivery are complete. The website was not deployed or
changed by this work.

## Export

| Property | Verified value |
| --- | --- |
| Master | `output/PoseTek-Draft-B-Coaches-2026-09-21.mp4` |
| Picture | 1080 × 1920, H.264, 30 fps, 1,350 decoded frames |
| Picture duration | 45.000 seconds |
| Container duration | 45.056 seconds, including AAC padding |
| Audio | Stereo AAC, 48 kHz |
| Master size | 15,621,663 bytes |
| Master SHA-256 | `a2f9b93bfc8d276750c121be43e5d7093044e5968af36b32b603cfc2a382a913` |
| Encoded audio loudness | -16.17 LUFS integrated, -1.81 dBTP |
| Email preview | 540 × 960, H.264/AAC, 2,905,355 bytes |

The master and email preview both decoded end-to-end with no FFmpeg errors.
The renderer reported a browser target-close message during final completion,
then completed successfully; decoded frame count, durations and inspected final
frames establish that the export is intact.

Every scene was visually inspected in style frames, followed by an eight-second
motion proof and a contact sheet extracted from the final encoded master.
The source typecheck passes. See the audio README for timing, subtitle,
transcription and sound-level checks and their limits. No direct listening review
was available in this runtime.

## Delivery

The master was uploaded as a new private file in the user's connected Google Drive.
Readback confirmed its video MIME type, title and exact byte size. The existing
Draft B was preserved. The new file remains owned by the user's existing Google
account; no public sharing was enabled.

At `2026-09-22T00:39:27Z` (September 21, 5:39 PM PDT), Outlook accepted the email
**“PoseTek Draft B — revised video for clubs and coaches”** to the user's verified
Outlook address. It includes the compact MP4 attachment and full-resolution Drive
link, with an instruction to open that link through the existing Google account.
Mailbox readback confirmed the matching subject and attachment presence. This
confirms sending and mailbox presence, not that the user has opened the movie.

Private Drive URLs, mailbox IDs and generated media are intentionally excluded
from Git. The local output files and emailed links are the viewing deliverables;
the files in this project retain the editable source and reproduction workflow.
