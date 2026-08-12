# Athlete result links

The website now has dedicated authenticated result pages for the two locally processed mobile drills:

- `broadJumpPage.html`
- `changeOfDirectionPage.html`

## Sending a link

1. Sign in as the coach and open the athlete in the Performance Dashboard.
2. Select **Broad Jump** or **Change of Direction**.
3. Use **Copy athlete link** on the result page.
4. Paste that link into an email or text message.

The link includes the athlete's Firestore player document ID, not their Firebase Auth UID. The recipient must sign in. After login, the website returns to the requested result page and verifies that the signed-in player resolves to that same player document.

Example URL shapes:

```text
broadJumpPage.html?player={playerDocumentID}&userType=player
changeOfDirectionPage.html?player={playerDocumentID}&userType=player
```

Coaches can open the same pages for roster members. Client-side access checks require the player to be present in the coach's `members` array (or have a matching coach reference). Firebase Security Rules remain the authoritative server-side access control.

## Player identity resolution

The result pages use the same cascade as the current mobile app:

1. `players.signupEmail == authenticated email`
2. `players.authenticationUID == authenticated UID`
3. `players.userUID == authenticated UID`
4. Direct `players/{authenticated UID}` fallback

This is required because coach-provisioned player document IDs are often different from their Auth UIDs.

## Mobile data contract

Result history is read from `players/{playerDocumentID}/reps`.

Broad Jump uses:

- Firestore: `broadJumpDistance`, `jumpHeight`, `takeoffFrame`, `landingFrame`
- Storage: `{playerDocumentID}/broadJump/session{N}/kick{N}/`
- Artifacts: `pose.json`, `metadata.json`, `foot_piecewise_fit.json`, `key_frames.json`, `foot_centers.json`, `com_midpoints.json`, `com_height.json`

Change of Direction uses:

- Firestore: `totalTime`, `totalDistance`, `outboundDistance`, `returnDistance`, `phase1Time`, `phase2Time`, `phase3Time`, marker and frame fields
- Storage: `{playerDocumentID}/changeOfDirection/session{N}/kick{N}/`
- Artifacts: `pose.json`, `metadata.json`

Raw video is not required. The mobile app's locally processed drill pipeline uploads the JSON artifacts even when cloud video saving is disabled.
