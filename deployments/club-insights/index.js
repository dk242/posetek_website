"use strict";

// Scoped deployment entrypoint: no other website callable is exported or loaded.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { createClubInsights } = require("./club-insights");
admin.initializeApp();
const clubInsights = createClubInsights({ db: admin.firestore(), HttpsError: functions.https.HttpsError });

function requireCaller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  return { uid: context.auth.uid, email: context.auth.token?.email || null, emailVerified: context.auth.token?.email_verified === true, isAnonymous: false };
}

exports.getClubInsights = functions.runWith({ timeoutSeconds: 120 }).https.onCall((data, context) => clubInsights.getClubInsights(data, requireCaller(context)));
