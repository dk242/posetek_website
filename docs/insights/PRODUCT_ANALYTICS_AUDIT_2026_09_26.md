# PoseTek analytics and observability: iteration 1 audit — September 26, 2026

Scope: read-only inspection of the current website and relevant native event producer source, deployed Functions/Cloud Monitoring configuration, and aggregate counts from production Firestore. No account, athlete, event, rule, function or deployment was changed. No personal identifiers or event payloads are included in this report. Production aggregate snapshots below were collected around 11:33–11:39 a.m. PDT, so they will change.

## The most important distinction

PoseTek currently has **first-party operational records and a custom Firestore engagement pipeline**, not a comprehensive Firebase/Google Analytics event implementation. Firebase Analytics/GA4 `logEvent` is not initialized in the current React website or found in the inspected native app source. A `measurementId` remains in old standalone HTML configuration, but configuration alone does not call Analytics or establish a current page/event stream. No `analytics_*` BigQuery export dataset was visible in the configured Google Cloud project. The public pages inject Microsoft Clarity; it is behavior/replay tooling, not a scoped coach/admin product-metrics source.

The live `recordInsightUsage` Cloud Function is ACTIVE, its Firestore `insightSettings/usage.enabled` gate is true, and it is receiving data. This is the source of the Usage dashboard. It should be called **estimated foreground engagement**, not exercise completion, unique site visitors, bookings or true retention.

## Live collection inventory

| Source | Live aggregate evidence | What it can support | What it cannot establish |
| --- | --- | --- | --- |
| `players/{id}/reps` | 1,956 source documents across all Firestore player profiles; 1,875 have a usable date and rep type; 420 dated in the last 30 days. | Recorded and qualified testing once server evidence/projection rules are applied. | Unique athletes or valid tests from raw document count alone; the 81 undated records cannot be placed in a period. |
| `players/{id}/workoutLogs` | 16 assigned-session logs, 8 ended, 4 ended `completed`, 4 ended early; 8 lack an ending. No duplicate identity among the 16 under the current deduplication function. | Logged workout starts/outcomes and prescribed-set evidence. | Physical attendance or currently exercising. Seven of eight open logs began more than a day ago; five more than a week ago. |
| `players/{id}/personalWorkoutLogs` | 0 documents. | Nothing observed yet for personal workout uptake. | Whether the feature is broken or simply unused. |
| `insightUsageIntervals` and `insightUsageDays/*/insightUsageDaily` | 947 accepted unique batch receipts covering 16,781 short intervals; 124.5 raw interval minutes vs 124.3 aggregated minutes; zero invalid summary bins in the readback. | Estimated active foreground time for observed athletes; web/device overlap is unioned. | Full population usage, visitors, conversion, or proof of exercise. Receipts are batches, not sessions or users. |
| Usage actor roots | 15 players have ever supplied web usage; **0 have iOS usage**. Web build tag is the static `web-insights-v2`, not a release SHA. First observed date September 17. Last 7 UTC dates contained 90 summarized minutes. | Coverage and relative feature allocation for supported web activity. | iOS adoption or cross-platform usage; absence may reflect an unreleased/uninstalled native tracker. |
| `aiIncidents` | 110 documents; 9 marked test. Prior client-only follow-up folding/test-label gaps are being fixed in an isolated website branch but are not deployed yet. | AI incident triage with known classification limits. | A reliable AI failure *rate* without a matching request denominator and consistent test exclusion. |
| `llmUsage` | 1,442 ledger rows total; 1,274 in the last 30 days, including 1,086 `complete`, 107 `failed`, 40 `validation_retry`, 41 `ok`. Estimated cost in that window sums to $4.7615 for priced rows; 113 rows have no numeric cost. | Model-attempt volume, latency, stage/capability, estimated cost where known. | User-visible success rate from row status, because one invocation may create multiple rows/retries and test traffic is not flagged in this ledger. Cost sum is incomplete when rows are unpriced. |
| Other live roots | `failureCases` 106; `testingEvents` 6; `insightSettings` 1. | Testing diagnostics and event operations, subject to each source's contract. | General website traffic. |

The admin Overview's observed 13/61 collection coverage is the selected roster/period, while 15 usage roots is cumulative across all Firestore players. These denominators are different and should never be silently combined. The all-player raw counts include historical, independent and possibly test records; they are not equivalent to the admin report's 61 included canonical players.

The direct workout deduplication yielded 16 unique events: 4 completed-as-logged, 4 ended early, and 8 open. Only 4 have timer duration, another 4 have a start/end elapsed estimate, and 8 have unknown duration. Twelve have a frozen prescription snapshot; none proves every prescribed set was recorded. Thus “completed” describes the log's ending, not full adherence. The dashboard already separates those concepts; a more beginner-friendly label would make that distinction harder to miss.

## Accuracy assessment

1. **Strongest: source-backed test qualification within a clearly defined roster.** The V2 projection reads actual reps, accepted revisions, processing evidence, deduplicates proven mirrors and exposes needs-review/undated/future categories. It does not invent results for missing evidence. Accuracy still depends on source capture and roster classification, and 81 of 1,956 raw all-player reps lack a usable date.
2. **Good but narrow: workout outcomes.** The source logs and current `workoutEvents` function reconcile for this small live set. Completion is self-reported/logged; all-prescribed-set completion is distinct. The eight old open logs mean `inProgress` must not be read as live activity. Durations are mixed timer/estimate/unknown and should never be summed without coverage labels.
3. **Internally consistent but incomplete: estimated usage.** The accepted receipts and daily bins reconcile within ~0.2 minute across the complete live readback. The server verifies an authenticated linked athlete, bounds intervals and unions overlaps. The web clock requires focus/visibility, recent interaction or progressing media/workout and limits idle time. But only 15 athlete roots have ever reported, none from iOS, rejected/lost uploads have no separate delivery-rate denominator, and static build tags cannot isolate release cohorts. Treat averages across all 61 included athletes as unavailable, not as 124.3/61.
4. **Misnamed for traction: “Returning players.”** Current definition is activity on at least two local days in the selected window. It is not D7/D30 retention, weekly cohorts, sustained training, or a repeat booking. The UI says this, but a product summary should use a phrase such as “Active on 2+ days.”
5. **Not yet measured: anonymous acquisition and product funnel.** No modern React `page_view`, CTA, enquiry-completion, signup-stage, feature-adoption or coach-action event pipeline was found. Clarity and old `measurementId` values cannot be used to assert conversion rates. This is the biggest missing analytics layer.
6. **Operational telemetry exists but is partial.** The AI incident pipeline, private LLM ledger, a Cloud Logging `ai_incidents` metric and one enabled “PoseTek AI incidents” alert exist. The configured BigQuery project has an `agent_gateway_logs` dataset with Cloud Run request/stdout tables, but no visible `analytics_*` GA4 export dataset. No custom Cloud Monitoring dashboard or uptime check was listed. Cloud Run/Firebase platform metrics exist, but there is no single admin-only observability view for traffic, service availability, errors, latency, queue/backlog, data-ingestion health and cost.

## Product metric design: small visible set, richer drill-down

### Coach view — simple, actionable

Show a date range and scope beside every metric. A first-screen set of four to six items is enough:

| Metric | Proposed definition | Source/next requirement |
| --- | --- | --- |
| Athletes needing a check-in | Count of scoped athletes with a recent logged pain/ended-early outcome or no active plan, with reasons and direct links. | Existing plans/logs; approved coach agent is implementing conservative version. Do not infer inactivity from absent usage. |
| Planned vs completed sessions | Completed-as-logged / sessions actually due in period. Show prescribed-set coverage separately. | Outcome logs exist; a due-date/schedule contract is needed before adherence percentage is honest. |
| Testing coverage | Athletes with all six qualified exercises / eligible roster; show partial/no tests and “needs review.” | Existing V2 projection. |
| Training participation | Distinct athletes with a recorded set or workout start/end in 7/28 days, with explicit source. | Existing logs; choose whether a mere start counts as participation. |
| Retest change | Paired qualified result for same athlete/exercise, consistent unit and enough sample, not a roster-best trend. | New server derivation; do not imply improvement from the current roster-best chart. |

### Admin product view — traction and conversion

| Metric | Proposed definition | Gap |
| --- | --- | --- |
| Eligible roster, activated, engaged | Separate denominators: enrolled/eligible; first meaningful test or workout; meaningful activity in 7/28 days. Exclude test traffic by explicit classification. | Define event and inclusion policy. |
| Signup funnel | Invitation delivered (if known) → code claimed → canonical account ready → first meaningful action. | Admission records cover some milestones; no complete event vocabulary or external delivery evidence. |
| Testing-to-training funnel | First qualified test → plan activated → first workout started → first completed log; stage cohort and elapsed time. | Sources exist but need consistent person identity, time ordering and cohort definitions. |
| Website acquisition | Anonymous visits → Book/enquiry CTA → real enquiry handoff/completion → account entry, by campaign/channel and device class. | No reliable first-party or GA4 funnel now. Do not count mailto click as a sent enquiry. |
| Retention | Weekly cohorts of athletes who return for a meaningful training/testing action in week 1/4; show cohort sizes. | New derived definition; current 2-day status is not retention. |
| Feature adoption | Distinct eligible athletes using training/program/results/AI, and successful outcomes, rather than raw screen time alone. | Some engagement feature minutes exist; precise adoption events do not. |

Recommended new event vocabulary is deliberately small: `page_view` (public route group only), `booking_cta_selected`, `enquiry_handoff_selected`, `signup_started`, `account_ready`, `first_qualified_test`, `plan_activated`, `workout_started`, `workout_ended`, `coach_followup_opened` and `ai_request_finished`. Server-authoritative milestones should be derived from committed Firestore records/jobs to avoid double counting client retries. Client-only events should be limited to acquisition and intentional UI actions. Each should have a versioned schema, allowed low-cardinality fields (`role`, `route_group`, `platform`, `release`, outcome class), deduplication identity, test/environment flag, retention, and no names, emails, invite codes, free text or raw URLs. Use cohorts, counts and percentages only when denominator and coverage are known.

Firebase's official [event guide](https://firebase.google.com/docs/analytics/web/events) distinguishes automatically collected, recommended and custom events; a Firebase app config `measurementId` by itself does not implement custom `logEvent`. The [Firebase reports guide](https://firebase.google.com/docs/analytics/reports) describes the optional BigQuery link for raw event analysis. Decide whether to use GA4 for anonymous acquisition, a private server-owned Firestore/BigQuery fact pipeline for athlete and coach outcomes, or both; never expose raw Firebase/BigQuery records directly to coaches.

## Separate admin-only observability feature proposal

Create a dedicated branch/worktree after agreeing on the first product definitions. The technical view belongs under Admin only, with server-side verification of the existing privileged admin role. It should not appear in coach navigation. A narrow first version:

1. **Traffic and availability:** public route requests/page views with bot and synthetic traffic separated; website availability check; callable/Cloud Run request volume, 5xx and p95 latency by service/release. Note that Netlify traffic and browser sessions may require an additional source; Cloud Run request counts are not website visitors.
2. **Critical journeys:** booking enquiry handoff, account admission success/failure, usage-ingestion accepted/rejected rate, plan generation success/failure and backlog, workout-save failures, testing processing backlog/failures. Where an event source is absent, show “Not instrumented,” not zero.
3. **AI operations:** incident counts by severity/capability with test traffic excluded, denominator-matched failure rate, retry/fallback, p95 response, and estimated cost with unpriced-row coverage. Keep existing incident detail as a drill-down.
4. **Health and action:** a small status banner, trend over selected window, actionable alert with owner/runbook, release version and last collection time; link to sanitized logs only for admins. Start with 2–3 SLOs and thresholds after baseline, not dozens of noisy alerts.

Cloud Monitoring supports custom dashboards, alerts and service SLOs ([dashboards](https://docs.cloud.google.com/monitoring/dashboards), [alerting](https://docs.cloud.google.com/monitoring/alerts)). The current enabled AI incident alert and [existing AI observability plan](/Users/happiness/src/posetek/posetek-mobile-app/docs/plans/AI_OBSERVABILITY_AND_IMPROVEMENT_PLAN.md) are a useful seed; a broader platform view should link to that work rather than replace it. A new PoseTek page should query aggregated, bounded server endpoints backed by Cloud Monitoring/Logging and existing sanitized ledgers. It must not put service credentials or raw user content in the browser. The technical view should remain distinct from the beginner-friendly Admin Product Analytics view.

## Iteration decisions to settle before coding analytics

1. Choose the primary first-screen product outcome: athlete activation/training, coach follow-up/team health, or acquisition/booking. The other two can be drill-downs.
2. Define “meaningful activity”: test qualified, workout started, at least one set recorded, completed-as-logged, or a combination. State the choice in plain language beside the metric.
3. Choose whether to use GA4 only for anonymous acquisition with privacy controls, a fully first-party event store, or both. Current Firestore records can remain the truth for athlete outcomes regardless.
4. Define test-account inclusion, staff/demo traffic and release tagging. Without these, cross-period trends and AI failure rates can be misleading.
5. Approve a separate admin-only observability branch after the product definitions, with no coach technical telemetry.

Evidence: [website usage client](/Users/happiness/src/posetek/posetek_website/app/src/lib/insight-usage/UsageTracking.tsx), [clock](/Users/happiness/src/posetek/posetek_website/app/src/lib/insight-usage/clock.ts), [server ingestion](/Users/happiness/src/posetek/posetek_website/functions/insight-usage.js), [V2 metric contract](/Users/happiness/src/posetek/posetek_website/docs/insights/V2_CONTRACT.md), [workout semantics](/Users/happiness/src/posetek/posetek_website/functions/insights-v2-qualification.js), [native tracker, read-only](/Users/happiness/src/posetek/posetek-mobile-app/KickAI/Insights/InsightUsageTracker.swift). The focused ingestion/projection/qualification suite passed 58 tests with 3 skipped and 0 failures. Temporary aggregate-only read scripts are in `/private/tmp/posetek-analytics-*-20260926.cjs` and `/private/tmp/posetek-observability-live-audit-20260926.cjs`.
