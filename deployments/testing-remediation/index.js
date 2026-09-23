"use strict";
// Isolated deployment entrypoint: no unrelated Firebase exports are discovered.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { createEffectiveResults } = require("./effective-results");
admin.initializeApp();
const results = createEffectiveResults({ db: admin.firestore(),
  bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), HttpsError: functions.https.HttpsError });
function caller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  return { uid: context.auth.uid, email: context.auth.token?.email || null,
    emailVerified: context.auth.token?.email_verified === true, isAnonymous: false };
}
const callable = functions.runWith({ timeoutSeconds: 120, memory: "512MB", maxInstances: 10 }).https;
exports.getAthleteEffectiveResults = callable.onCall((data, context) => results.getResults(data || {}, caller(context)));
exports.getAthleteRepMedia = callable.onCall((data, context) => results.getMedia(data || {}, caller(context)));
