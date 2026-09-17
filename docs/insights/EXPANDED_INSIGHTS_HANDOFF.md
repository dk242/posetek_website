# Expanded PoseTek Insights

The `/insights` application route expands Taiyo's dashboard into Overview,
Testing, Workouts and Usage. All four share the current canonical organization,
team, dates and demographic filters. Administrators may select every canonical
organization; managers include their organization's unassigned athletes; coaches
receive only the intersection of their current assigned teams and canonical
player ownership. Legacy roster arrays do not grant reporting access.

See [V2_CONTRACT.md](V2_CONTRACT.md) for fields, bounds, qualification and
freshness semantics, and [the scoped release instructions](../../deployments/expanded-insights/README.md)
for deployment and recovery. The previous `getClubInsights` callable remains
available for rollout compatibility.

## Interpreting the report

- The default is 56 local dates through today, in America/Los_Angeles. The
  timezone selector controls date boundaries, including DST. Cumulative testing
  means qualifying captures through the selected end, while activity and
  performance trends use the selected period.
- Divisions come only from verified roster metadata, with provenance. The label
  is **Boys/Girls divisions**. No gender is inferred or written to athlete profiles.
  Age uses valid birth dates, supported legacy birth dates, then recent recorded
  ages. Unknown information remains visible. Distributions describe the current
  roster; transfers carry history with current canonical ownership.
- A recording document, qualifying result and distinct supported attempt are
  separate counts. Explicit linked duplicates remain in the source and receive
  separate reporting counts. Unverified processing evidence does not qualify.
  Accepted matching manual revisions take precedence over stale sidecars.
- Full testing requires Shooting, Sprint, Vertical Jump, Broad Jump, Dribbling
  and Agility/COD. Free Record does not contribute. Successful coverage may
  coexist with failed or incomplete attempts. Undated evidence is a visible
  review marker and never invents a date or successful test.
- Workout completion means the actual log says it ended completed. Completing
  every prescribed set is calculated separately; missing prescriptions remain
  unknown. Linked logs count once. Prescriptions, reservations and uploaded reps
  are not completed workouts. Timer minutes and elapsed estimates remain separate.
- Every breakdown has counts, denominators and an accessible table. Chart
  selections filter the roster; complete totals are independent of player pages.
  Empty, loading, retry and changed-access states do not display partial totals.

## Estimated active use

`recordInsightUsage` accepts authenticated athlete self-activity only. It derives
the canonical player inside a transaction. A coach viewing or recording an
athlete never contributes usage to that athlete. Anonymous, administrative,
staff and ambiguous identity bindings are rejected. The server gate is
`insightSettings/usage.enabled`; setting it to false stops new collection without
removing existing reports or touching workout/planner behavior.

Both clients send schema 1 batches with a session UUID, idempotent sequence,
platform, build and allowlisted feature intervals. Ordinary interactions use a
two-minute idle cutoff. Foreground progressing video and an active guided-workout
timer extend activity; background, focus/lock changes and identity changes stop
counting. Monotonic clocks detect suspension and wall-clock jumps. Offline retries
are bounded to 72 hours; duplicate sequences must contain the same payload.

Web collection covers the signed-in athlete application, not the preserved
public marketing pages. Web Locks coordinate recoverable browser queues without
sharing an instance identity between duplicated tabs. Browsers without Web Locks
keep their own queue and rely on server deduplication rather than deleting or
adopting another tab's queue. Clients tolerate disabled collection and transient
network errors; collection failure never blocks training.

The server unions overlapping intervals across tabs/devices. Combined minutes
are not the sum of platform minutes when intervals overlap. Feature attribution
uses a disjoint priority: workout, video, training, results, planner, feed,
overview, other. These are estimates of foreground engagement, not proof of
exercise or attendance. Workout timer minutes are never substituted for usage.

Historical absence is **Not collected**, including periods before a platform's
first observed collection. Coverage reports show athletes observed on supported
web/iPhone builds and collection start dates; an absent iPhone signal does not
prove that the athlete never used the older app.

Firestore TTL policies use `expiresAt` on these dedicated collection groups:

| Collection group | Retention |
|---|---|
| `insightUsageIntervals` | 90 days from receipt |
| `insightUsageDetailDays` | 90 days for exact merged intervals |
| `insightUsageDaily` | 24 calendar months from the UTC summary date |
| `insightUsageActors` | One day for upload-rate counters |

Daily summaries retain totals in 15-minute aggregate bins for timezone reports;
they do not retain exact interval endpoints or session identities. The separate
90-day detail enables exact cross-device unions during the bounded retry window.
Raw session receipts remain private. TTL deletion is
asynchronous. Reads additionally exclude expired summaries. None of these paths
is directly readable or writable by application clients, including administrators.
Reports omit contacts, private notes, storage paths and raw processing evidence.
The privacy page documents this first-party collection.

## iPhone handoff to Taiyo

The isolated mobile branch is
[`codex/expanded-insights-usage`](https://github.com/athelyticsOG/posetek-mobile-app/tree/codex/expanded-insights-usage),
based on current mobile main `98d8a051f0580785b70610f5c1a29a5246e08bfb`.
The handoff commit is `4307f13b96a48c6dcc5af53e72a517f4e7773d2e`.

Use the branch's
[Mac/TestFlight checklist](https://github.com/athelyticsOG/posetek-mobile-app/blob/4307f13b96a48c6dcc5af53e72a517f4e7773d2e/docs/plans/INSIGHT_USAGE_HANDOFF.md).
It includes the shared KickAI Xcode scheme, existing app/widget identities,
dependency and ignored-configuration checklist, 18 XCTest cases, physical-device
scenarios and release notes. Native planner generation is preserved.

Windows validation covers source/PBX/XML membership and the shared contract;
Xcode compilation, simulator and device tests, signing and TestFlight upload
remain for Taiyo's Mac. No native build or TestFlight upload was claimed or
performed here. iPhone usage is unavailable until athletes install this build.
No message or invitation has been sent to Taiyo automatically.

## Operator evidence

Private manifests, source snapshots, before-images, migration receipts, report
responses and workbook evidence stay under ignored `.netlify/` paths. The
reporting import writes only `players/{id}/insightMetadata/reporting`; it preserves
profiles, contacts, original timestamps, measurements, workouts and recordings.
The verified workbook is a source of reporting provenance and is not modified.

For the September 16 checkpoint, the intended reconciliation is 36 included
athletes (20 boys, 16 girls), two explicitly excluded test profiles, 16 usable
ages, 325 source recording documents and the audited 10 fully / 24 partially /
two no-record classifications. The production receipt records the executed live
checks; fixture parity alone is not evidence that deployed reads reconcile.

The deliberately composed website artifact preserves the approved homepage,
coaches page and unrelated routes. A normal marketing-only build does not ship
application changes. After promotion, update `deployment/homepage-baseline.json`
from that exact production inventory and verify the ordinary marketing build
preserves it. Do not promote a different rebuild than the tested preview.
