# Legacy upload processor archive guard

This is a separate recovery of the live `onVideoUpload` function in `us-west1`.
It is not imported by the main `functions/index.js` and must not be deployed as
part of an unrelated website or feed release.

The serving Cloud Run revision on September 16 was `onvideoupload-00020-vbz`,
created May 1, 2026. Its build metadata identified the May source archive. The
newest July archive had the entire handler commented out and its revision failed
startup; it was not the code serving requests. The recovered May `index.js` has
SHA-256 `7b0de5c21b29c36c537290cde2f94656881e9d76528514a0c012f7e4f78758e4`.
The original archive and complete service/function configuration are kept privately.

The only behavior change is an early return for configured historical recordings.
`POSETEK_REPAIR_ARCHIVES` is a private JSON map of
`SHA256(bucket + "\n" + objectName)` to base64 MD5. The September repair configures
eight video pairs (16 paths), including source paths for rollback restores. A
known path with missing checksum metadata is also skipped. Different bytes at
that path and all unrelated uploads follow the original behavior.

Keep these exact archive guards through delayed and duplicate event deliveries
and any future rollback. Copy, rewrite and restore create Storage finalization
events; setting custom object metadata does not suppress those events. Do not
remove this guard during another source recovery or replace it with a general
switch disabling processing.

The original signed-URL and processor request behavior, including historical
logging and error handling, remains in the recovered source. It was not broadened
into a processor redesign during the data repair.

Run the isolated synthetic handler tests with:

```powershell
node repair-guard.test.cjs
```

Tests mock both Storage and HTTP and verify that archived events request neither,
while ordinary video and body scan processing retains its original contract.
Deployment changes only this function's source and adds the private guard
environment variable, preserving the other six environment variables, trigger,
service account, resource settings and public entry point. Review the live
configuration before any later deployment. See the sanitized
[repair handoff](../../docs/VACAVILLE_DATA_REPAIR.md) for the actual rollout result.
