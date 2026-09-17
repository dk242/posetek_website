# Canonical team leaderboard source overlay

The September 17 reviewed serving `getTeamLeaderboard` version 1 returns raw
rep metrics. Athlete teammates cannot use the private athlete results endpoint,
so this existing authorized projection must qualify its own whitelisted rows.

The overlay preserves the live entrypoint, dependencies, runtime, timeout,
memory, environment and IAM. It replaces the leaderboard helper and path parser,
adds the effective evidence modules, and injects the resolver into the existing
initializer. Initial team/legacy roster authorization is preserved and repeated
after evidence work. Only qualified, nonduplicate measurements are returned;
metadata transport failures fail the request. No teammate media paths, private
reports or contact fields are exposed. Foot/course fields already reviewed in
the source repository are included in the metric whitelist.

Prepare from the exact private live capture using `prepare.cjs`. Its checked-in
baseline contains file hashes only. The output must remain in an ignored private
directory. Deploy only `getTeamLeaderboard` with
`deployments/testing-remediation-upload/v1-source-only.cjs`; never deploy the
other historical exports in the recovered entrypoint. The deployment helper
changes only `sourceUploadUrl` and verifies exact deployed archive bytes plus
unchanged configuration and IAM. Keep before/candidate/verified receipts private.

Validation: `node --test functions/team-leaderboard.test.js functions/clubs.test.js`
and `node --test deployments/testing-remediation-leaderboard/prepare.test.cjs`.
