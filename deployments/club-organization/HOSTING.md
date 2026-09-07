# Firebase Hosting artifact preparation

**Production target correction:** public HTTP headers on September 7 confirm `https://posetek.net` is served by **Netlify**. The Firebase site below has no custom-domain bindings. Publishing it does **not** release the production PoseTek website. Keep this prepared Firebase path separate; the requested website release must use the existing Netlify site after its deployment identity/configuration is verified. No Hosting release was performed during this preparation.

The Hosting release tool uploads an existing, reviewed `dist` using the [Hosting REST API](https://firebase.google.com/docs/hosting/api-deploy). It never invokes Firebase CLI hooks, npm, dependency installation, a build, or a new cache. Gzip data is held one file at a time in memory; no compressed artifact copies are written. The token comes from the existing `gcloud auth print-access-token` login and remains in memory. The API requires `x-goog-user-project: kickai-69dd0` with this login; no ADC or Firebase CLI login change is needed.

The only target is `kickai-69dd0`. The other site, `kickai-idp-view`, is untouched. On September 7, the target's live release was `sites/kickai-69dd0/releases/1787686917145000`, version `sites/kickai-69dd0/versions/3fcd5b23a59236fc`, released August 25. The live configuration had two no-cache HTML/JS/CSS header rules, no redirects, and no SPA rewrite. Preparation preserves the complete live config, adds the reviewed `firebase.json` rules (the SPA fallback and immutable hashed-assets caching), and rejects conflicting live/local rules. The fallback is required for `/organization`, `/join`, and existing React aliases such as `/profile.html`.

The live file inventory also contains repository internals (`.git`), tooling, and old functions source. Do not copy those files into the new artifact or restore that version casually: rolling back to it would restore those served paths. The tool obeys this repository's exact Hosting ignore policy, including hidden files, node_modules, the backfill page, and logo-export page. Baseline snapshots contain file paths/hashes and release metadata, not fetched file contents.

Run in the web feature checkout with its existing built output. The first command reads Firebase; the second is offline and writes a private plan:

```sh
python3 deployments/club-organization/hosting_release.py snapshot \
  --output /private/tmp/club-hosting-baseline.json
python3 deployments/club-organization/hosting_release.py prepare \
  --dist dist --firebase firebase.json \
  --baseline /private/tmp/club-hosting-baseline.json \
  --output /private/tmp/club-hosting-plan.json
python3 -m unittest discover -s deployments/club-organization -p test_hosting_release.py
```

Inspect the plan's complete config, file hashes, removed paths, byte counts and `planHash`. Root must verify that this exact artifact is the tested build and that required rules/functions/gateway work is ready before choosing the production release. The script cannot prove a browser check or application behavior from a hash; record those checks separately. If source or dist changes, rebuild through the authorized primary workflow and prepare a new plan. Moving the worktree requires preparing again because the plan binds absolute paths.

The following command creates a draft version, uploads only required gzip hashes, verifies the full remote file/config map, finalizes it, and explicitly publishes it:

```sh
python3 deployments/club-organization/hosting_release.py publish \
  --plan /private/tmp/club-hosting-plan.json \
  --journal /private/tmp/club-hosting-journal.json
```

Publication requires unchanged artifact/config hashes and the same live baseline release before creation and immediately before release. A private mode-600 journal includes the full previous release/config/file snapshot before any remote mutation, the created version, upload progress and final release readback. Finalized versions are immutable. Hosting's release API does not provide a compare-and-swap condition, so the final check cannot prevent an external publisher racing in the instant before the release request; coordinate the release window. This tool does not add a second repository lock.

If a call fails, inspect the journal and current live release before any retry. A lost acknowledgement can still mean the release succeeded. The tool reads back after failure, never automatically republishes or rolls back, and refuses an existing journal path. An abandoned draft/finalized version does not change the live site. Preserve it as evidence until the outcome is reviewed.

After release, verify `/`, `/organization`, `/join`, `/profile.html`, retained legacy drill URLs and hashed assets on the actual custom domain and default Hosting URL; check the expected response headers and exercise role/invite flows. HTML response success alone does not verify Firebase authorization. The source/artifact tests and publisher's readback are separate from these product checks.

References: [version files and gzip hashes](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions/populateFiles), [release creation](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/create).
