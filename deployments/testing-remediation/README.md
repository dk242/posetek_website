# Testing-result read services

This package exposes only `getAthleteEffectiveResults` and `getAthleteRepMedia`.
Both authenticate the caller and recheck current player access in the handler.
It does not deploy the shared-link handlers, video upload processor, rules or
Insights triggers. Those have separately captured source and rollout receipts.

Prepare and verify with `prepare.py --mode prepare|verify --run-dir <ignored-dir>
--credential-file <existing-short-lived-session>`. The shared release verifier
captures existing function configuration, IAM and source, pins every candidate
byte, verifies the deployed source and checks that unrelated functions remain
unchanged. Credentials and operator receipts must remain under ignored `.netlify`.

After preparation and scoped dependency installation, deploy only with:

```powershell
firebase deploy --project kickai-69dd0 --config <run-dir>/firebase.json --only functions:testing-results --non-interactive
```

Run verification immediately after that deployment, before changing other
function scopes. Read-only callables expose public transport so Firebase can
validate the caller token inside the handler; they do not permit anonymous data
reads. Never replace this scope with a project-wide functions deployment.

Rollback uses the saved source/configuration/IAM for existing endpoints, with a
fresh current-version check. Newly introduced endpoints can remain deployed while
the website is rolled back; they are additive readers and do not rewrite athlete
history. Keep the September 17 reporting rules and TTL policies intact.
