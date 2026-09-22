# Station recovery and ending — 2026-09-22

Status: code complete; 51 backend tests, 25 website rules assertions and 9 canonical mobile
rules tests passed. Mobile focused suites pass (59 tests); signed-app UI verification passed.
Physical-iPhone acceptance and deployment remain outstanding.

`closeTestingEvent({eventId, force:true})` now lets the event owner, a club manager or a verified
admin end an incomplete live event. It preserves results/reservations/progress, records
`closedByUid` and `endedEarly`, closes the event and expires all three station leases in one
transaction. Repeated calls preserve the original ending record. Omitting force retains the
existing readiness-only behavior. A non-owner ordinary coach cannot force-close the event.

Claim, renewal, takeover and calibration-reset transactions recheck that the event is live,
preventing a request authorized just before closure from reactivating a station afterward.
The one-line rules change requires live status for direct check-in/progress writes. Existing
rep/session upload permissions remain available so captured reps can finish syncing.

Closure finalizes currently available results. Closed events also allow the existing dirty-player
finalization sweeper to process late results without requiring all stations to be complete.
Projection failures retain their dirty marker for the next sweep.

The mobile companion adds station-only failed-attempt video retention and automatic progression,
Station 2 calibration before athlete arrival, snapshot-based broad-jump processing, directional
kick gates and End session confirmation. Standalone broad jump keeps its prior 120 fps in-video
marker processing. No video-trigger, IAM, Storage-rule or website-hosting changes are needed.

Validation:

- `node --test functions/testing-events.test.js functions/clubs.test.js`: 51 passed.
- Website rules: 25 assertions; canonical mobile rules: 9 tests passed.
- Mobile StationCoordinator15, BroadJumpProcessingMath7, CalibrationGeometry21,
  DrillRepUploadQueue13 and ScheduledVideoControllerCommit3: 59 passed.
- Device compile, test build and signed simulator build passed against mobile `2da3856`.
- Inspected the four shared station layout renders, including landscape setup and Start controls
  with 30-player queues. Real signed-app navigation reached End session confirmation; Keep testing
  dismissed it and preserved the live event. No production event was ended or station claimed.
- Backend source `5898529` passed the tests above. Existing caches and canonical simulator only;
  disk stayed at least 11 GiB free. Test emulators stopped. Scoped verification exception closed.
- Physical camera/audio/calibration, three-device ending and late-upload acceptance remain pending
  in the mobile `docs/plans/STATION_TESTING_MODE_PLAN.md`.

## Deployment commands

Run from this repository after local merge. The command includes the preceding enrollment/start
updates so it also covers installations that have not deployed that earlier follow-up.
There are no new IAM grants or `gcloud` permissions to apply.

```bash
cd /Users/nolanjetter/Documents/GitHub/posetek_website
firebase deploy --project kickai-69dd0 --only functions:addTestingParticipant,functions:startTestingEvent,functions:closeTestingEvent,functions:claimTestingStation,functions:renewTestingStationLease,functions:takeOverTestingStation,functions:resetTestingStationCalibration,functions:reconcileTestingRepProgress,functions:reconcileTestingStationProgress,functions:sweepTestingEventFinalizations,firestore:rules
```

The updated mobile app must also be installed on each station phone. Do not deploy the mobile
repository's lockdown rules, hosting, or the legacy video trigger for this change. No deployment,
Git push, athlete-data mutation or termination of a production event was performed during this task.
