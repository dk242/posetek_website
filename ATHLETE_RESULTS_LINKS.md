# Athlete result links

The website has dedicated shareable result pages for the two locally processed mobile drills:

- `broadJumpPage.html`
- `changeOfDirectionPage.html`

## Sending a link

1. Sign in as the coach and open the athlete in the Performance Dashboard.
2. Select **Broad Jump** or **Change of Direction**.
3. Use **Copy secure results link** on the result page.
4. Paste that link into an email or text message.

The recipient does not create an account or sign in. The link contains a random bearer token and opens the athlete's shared results immediately.

One link gives the recipient access to both permitted result pages. They can switch between Broad Jump and Change of Direction from the page, so generate and send the link once rather than generating separate links for each drill.

Example URL shapes:

```text
broadJumpPage.html?share={randomToken}
changeOfDirectionPage.html?share={randomToken}
```

The coach must be authenticated and authorized for that roster member to create the link. The raw token is returned once and only its SHA-256 hash is stored. Links expire after 30 days. Creating a replacement link revokes the athlete's previous link.

The token is the viewing credential: anyone the recipient forwards it to can view the shared results until it expires or is replaced. Never place coach credentials or a player document ID in the public URL.

## Backend flow

Three Firebase callable functions implement accountless access:

- `createAthleteResultsShare`: authenticated coach authorization and token creation
- `getAthleteResultsShare`: public-token validation and whitelisted athlete/rep metrics
- `getAthleteSharedRepArtifacts`: public-token validation and 15-minute signed JSON artifact URLs

Firestore and Storage remain private to unauthenticated clients. Public viewers receive sanitized fields through the Admin SDK only after the backend validates the token, expiry, revocation state, and requested drill.

## Deployment requirement

Accountless links require both the website files and these three callable functions to be deployed. A VS Code Live Server can test the coach UI, but **Copy secure results link** cannot work until the Firebase Functions are deployed to `kickai-69dd0`.

After deployment, test the recipient link in a private/incognito window. It should open results immediately without showing the login page.

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
