# Live testing-event enrollment — 2026-09-22

Status: code complete; server unit tests and both rules-emulator checks passed. Mobile physical-device verification outstanding. Feature branch: `station-live-enrollment`.
Mobile companion: `station-guided-flow` in PoseTek-mobile-app. No deployment or push performed.

Station 1 can check in an existing event participant, add another player from the authorized club
roster, or create a canonical team-linked player with the existing `createClubPlayer` callable and
then enroll that returned player ID. Mobile keeps creation separate from retrying enrollment and
requires roster reload after an uncertain creation response, avoiding duplicate profile retries.

`addTestingParticipant({ eventId, playerId, deviceId })`:

- Requires a live event, its authorized operator, the current Station 1 device lease, canonical
  organization/team membership, and the 30-athlete pilot cap. Client-supplied names/teams are not
  accepted as athlete identity. Newly created unregistered players and missing weight are supported.
- Extending the event's team list requires access for all current operators; admin identity comes
  from Admin Auth lookup, ordinary staff access from canonical membership. The event never grants
  cross-team access. Staff assignment changes remain the existing manager workflow.
- Reserves one participant slot transactionally with `enrollmentStatus: pending`. Retries use the
  same canonical player document ID and repair missing reservations through existing idempotent
  session/counter transactions. Six reservations cover all 20 reps before enrollment is ready.
- Revalidates event/access/lease, marks admission ready, increments reservationCount exactly once,
  and writes check-in in one transaction. Repeated calls preserve the ordinal and do not re-reserve.
  The narrow rules change prevents older clients from checking in a pending admission directly.
  Existing participant snapshots without enrollmentStatus behave as ready for compatibility.
- The close callable reads roster count and progress in the same closing transaction. Pending
  admissions cannot disappear from the expected station count. Repeated/concurrent start calls do
  not overwrite counts added after the event became live.

Validation completed:

- `node --test functions/testing-events.test.js functions/clubs.test.js`: 47 passed, zero failed
  (26 event tests including nine new admission cases; 21 existing club cases).
- `node --check functions/index.js` and `git diff --check`: passed.
- Website rules emulator: 22 assertions passed. Mobile canonical station rules: 8 tests passed.
- Read-only production audit confirmed all preexisting station functions are deployed. Live rules
  `89b245be-1307-46f2-9f73-1ed5c00de7a5` (2026-09-22T03:24:50.733165Z) match this candidate except
  for the one-line pending-enrollment guard. Baseline SHA-256:
  `3b642da7760238200baa3a740a57cdca81900a81501631249f1662b091952522`.

Still pending:

- Physical-iPhone station/audio/processing checks and the three-device pilot remain pending.
  Mobile implementation `0a543dd` passed current-source device compile, test build, signed simulator
  build and 33 focused tests under Nolan’s scoped existing-cache verification authorization. Three
  30-player station layouts were rendered and inspected; Start stays visible. Actual signed-app
  navigation reaches the existing live Team Testing event. No live station lease or athlete data
  was changed during this UI check.
- Automatic approval review rejected production deployment because the scoped verification
  approval did not explicitly authorize persistent production changes. Separate approval for the
  exact release was requested; nothing deployed. After explicit approval, deploy only `addTestingParticipant`, updated `startTestingEvent`, updated
  `closeTestingEvent`, and the narrow website Firestore rules change. Confirm any existing station
  service deployment prerequisite independently. Do not deploy hosting, mobile lockdown rules, or
  the legacy video trigger as part of this follow-up. No real athlete records were mutated in tests.

Device acceptance: enroll an existing player, add a new player to a selected team, retry a failed
admission, confirm all three phone queues, then record 3/7/10 reps with one Start session action per
athlete/station. Verify immediate results, foot changes, drill transitions, station completion,
wrong-player/wrong-foot handling, pause/background/lease takeover, and fixed landscape Start.
