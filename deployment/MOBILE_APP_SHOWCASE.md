# Mobile application showcase — September 16, 2026

Brief: make the phone-based product clear while preserving the current scrolling homepage and demos. Direct build within the existing PoseTek design system.

Reference lock: PoseTek owns the dark green canvas, condensed headings, lime actions and generous section spacing. A single upright phone appears beside the closing invitation; it stays flat and readable, rather than a tilted decorative render. The actual mobile workout player supplies the screen hierarchy, emerald surfaces, lime #7CFF18 action, set circles, drill media and bottom action. The existing recorded-data demos and profile stay unchanged.

| Decision | Source | Role |
| --- | --- | --- |
| Show a workout inside a phone, with concise app copy | User request; existing website | Explain where the player uses the product |
| Workout, drill media, set progress and one action | `KickAI/TrainingHub/WorkoutPlayerView.swift`, `WorkoutNowCard.swift` | Source-grounded mobile illustration |
| Emerald background, lime action, rounded cards | Mobile `PoseTekDashboardComponents.swift` | App-only tokens; website colors remain intact |
| Lead with actual product UI and a task | https://www.technefutbol.com/ | Narrow reference for demonstrating the mobile product through its function |
| Readable upright device, visible focus and touch-sized action | Refero Design craft guidance | Accessible code-native illustration |

Mobile reference commit: `98d8a051f0580785b70610f5c1a29a5246e08bfb`; the mobile checkout was read-only.

The phone is an interactive web illustration, not a captured screenshot or live mobile session. Existing public sample drill data and the website's instructional diagram are reused. Complete set / End rest advances a local preview; timers are duration labels, not running clocks; nothing is persisted. No app-store availability or new capture capability is implied. No private athlete photos or records are used. No bitmap generation or Figma export is needed for this editable UI. Higgsfield tools remain unavailable in this session.
