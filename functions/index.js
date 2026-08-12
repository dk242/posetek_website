const functions = require("firebase-functions");
const admin = require("firebase-admin");
const stripe = require("stripe");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const ATHLETE_SHARE_COLLECTION = "athleteResultShares";
const ATHLETE_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATHLETE_ARTIFACT_URL_TTL_MS = 15 * 60 * 1000;
const ATHLETE_SHARE_DRILLS = new Set(["broadJump", "changeOfDirection"]);
const ATHLETE_SHARE_ARTIFACTS = {
  broadJump: [
    "pose.json",
    "metadata.json",
    "foot_piecewise_fit.json",
    "key_frames.json",
    "foot_centers.json",
    "com_midpoints.json",
    "com_height.json",
  ],
  changeOfDirection: ["pose.json", "metadata.json"],
};

function athleteShareTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validAthleteShareToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(token);
}

function athleteShareError() {
  return new functions.https.HttpsError(
    "permission-denied",
    "This results link is invalid or has expired. Ask the coach for a new link."
  );
}

async function coachDocumentForUid(uid) {
  const direct = await db.collection("coaches").doc(uid).get();
  if (direct.exists) return direct;
  const query = await db
    .collection("coaches")
    .where("userUID", "==", uid)
    .limit(1)
    .get();
  return query.empty ? null : query.docs[0];
}

function coachCanViewPlayer(coachDoc, uid, playerDoc) {
  const coach = coachDoc.data() || {};
  const player = playerDoc.data() || {};
  const members = Array.isArray(coach.members) ? coach.members : [];
  const linkedCoachIds = [
    player.coachUID,
    player.coachId,
    player.coachDocId,
  ].filter(Boolean);
  return (
    members.includes(playerDoc.id) ||
    linkedCoachIds.includes(uid) ||
    linkedCoachIds.includes(coachDoc.id)
  );
}

async function verifiedAthleteShare(token, requestedDrill) {
  if (!validAthleteShareToken(token) || !ATHLETE_SHARE_DRILLS.has(requestedDrill)) {
    throw athleteShareError();
  }
  const hash = athleteShareTokenHash(token);
  const shareDoc = await db.collection(ATHLETE_SHARE_COLLECTION).doc(hash).get();
  if (!shareDoc.exists) throw athleteShareError();
  const share = shareDoc.data() || {};
  const expiresAtMs = share.expiresAt?.toMillis?.() || 0;
  const allowedDrills = Array.isArray(share.allowedDrills)
    ? share.allowedDrills
    : [];
  if (
    share.revoked === true ||
    expiresAtMs <= Date.now() ||
    !allowedDrills.includes(requestedDrill) ||
    !share.playerDocId
  ) {
    throw athleteShareError();
  }
  const playerDoc = await db.collection("players").doc(share.playerDocId).get();
  if (
    !playerDoc.exists ||
    playerDoc.data()?.activeResultsShareHash !== hash
  ) {
    throw athleteShareError();
  }
  return { hash, shareDoc, share, playerDoc };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerNumber(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function sanitizedAthleteRep(doc, drill) {
  const data = doc.data() || {};
  const common = {
    id: doc.id,
    repType: drill,
    drillType: drill,
    sessionNumber: integerNumber(data.sessionNumber),
    repNumber: integerNumber(data.repNumber),
    absoluteRepNumber: integerNumber(data.absoluteRepNumber),
    createdAtMillis: data.createdAt?.toMillis?.() || null,
  };
  if (drill === "broadJump") {
    return {
      ...common,
      broadJumpDistance: finiteNumber(data.broadJumpDistance),
      jumpHeight: finiteNumber(data.jumpHeight),
      takeoffFrame: integerNumber(data.takeoffFrame),
      landingFrame: integerNumber(data.landingFrame),
    };
  }
  return {
    ...common,
    totalTime: finiteNumber(data.totalTime),
    totalDistance: finiteNumber(data.totalDistance),
    outboundDistance: finiteNumber(data.outboundDistance),
    returnDistance: finiteNumber(data.returnDistance),
    phase1Time: finiteNumber(data.phase1Time),
    phase2Time: finiteNumber(data.phase2Time),
    phase3Time: finiteNumber(data.phase3Time),
    phase1Percent: finiteNumber(data.phase1Percent),
    phase2Percent: finiteNumber(data.phase2Percent),
    phase3Percent: finiteNumber(data.phase3Percent),
    markerDistance: finiteNumber(data.markerDistance),
    startFrame: integerNumber(data.startFrame),
    apexFrame: integerNumber(data.apexFrame),
    endFrame: integerNumber(data.endFrame),
    phase1EndFrame: integerNumber(data.phase1EndFrame),
    phase2EndFrame: integerNumber(data.phase2EndFrame),
  };
}

function storageFolderCandidates(playerDocId, drill, rep) {
  const folders = [];
  const storagePath =
    typeof rep.storagePath === "string"
      ? rep.storagePath.replace(/\\/g, "/")
      : "";
  if (storagePath && !/^https?:/i.test(storagePath)) {
    let clean = storagePath
      .replace(/^gs:\/\/[^/]+\//i, "")
      .split("?")[0]
      .replace(/^\/+|\/+$/g, "");
    const parts = clean.split("/");
    if (/\.(mov|mp4)$/i.test(parts[parts.length - 1] || "")) parts.pop();
    clean = parts.join("/");
    if (clean) folders.push(clean);
  }
  const sessionNumber = integerNumber(rep.sessionNumber) || 1;
  const repNumber = integerNumber(rep.repNumber) || 1;
  folders.push(
    `${playerDocId}/${drill}/session${sessionNumber}/kick${repNumber}`
  );
  return [...new Set(folders.filter(Boolean))];
}

/**
 * Creates one accountless athlete-results link. A replacement link revokes the
 * previous link for that player. The raw bearer token is returned once and is
 * never stored; Firestore contains only its SHA-256 hash.
 */
exports.createAthleteResultsShare = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Sign in as a coach to create an athlete results link."
      );
    }
    const playerDocId = String(data?.playerDocId || "").trim();
    if (!playerDocId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "playerDocId is required."
      );
    }

    const [coachDoc, playerDoc] = await Promise.all([
      coachDocumentForUid(context.auth.uid),
      db.collection("players").doc(playerDocId).get(),
    ]);
    if (
      !coachDoc ||
      !playerDoc.exists ||
      !coachCanViewPlayer(coachDoc, context.auth.uid, playerDoc)
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "This athlete is not on your roster."
      );
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = athleteShareTokenHash(rawToken);
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + ATHLETE_SHARE_TTL_MS
    );
    const playerData = playerDoc.data() || {};
    const previousHash =
      typeof playerData.activeResultsShareHash === "string"
        ? playerData.activeResultsShareHash
        : null;

    const batch = db.batch();
    batch.set(db.collection(ATHLETE_SHARE_COLLECTION).doc(tokenHash), {
      playerDocId,
      allowedDrills: [...ATHLETE_SHARE_DRILLS],
      createdByUid: context.auth.uid,
      createdByCoachDocId: coachDoc.id,
      createdAt: now,
      expiresAt,
      revoked: false,
    });
    batch.set(
      playerDoc.ref,
      {
        activeResultsShareHash: tokenHash,
        activeResultsShareExpiresAt: expiresAt,
      },
      { merge: true }
    );
    if (previousHash && previousHash !== tokenHash) {
      batch.set(
        db.collection(ATHLETE_SHARE_COLLECTION).doc(previousHash),
        { revoked: true, revokedAt: now },
        { merge: true }
      );
    }
    await batch.commit();

    return { token: rawToken, expiresAtMillis: expiresAt.toMillis() };
  }
);

/** Returns whitelisted metrics for a valid accountless share link. */
exports.getAthleteResultsShare = functions.https.onCall(async (data) => {
  const drill = String(data?.drill || "");
  const { share, playerDoc } = await verifiedAthleteShare(data?.token, drill);
  const playerRef = db.collection("players").doc(share.playerDocId);
  const repsSnapshot = await playerRef.collection("reps").get();

  const reps = repsSnapshot.docs
    .filter((doc) => {
      const rep = doc.data() || {};
      return rep.repType === drill || rep.drillType === drill;
    })
    .map((doc) => sanitizedAthleteRep(doc, drill))
    .sort(
      (left, right) =>
        (right.createdAtMillis || 0) - (left.createdAtMillis || 0) ||
        (right.absoluteRepNumber || 0) - (left.absoluteRepNumber || 0)
    );
  const player = playerDoc.data() || {};
  return {
    athlete: {
      firstName: String(player.firstName || "").slice(0, 100),
      lastName: String(player.lastName || "").slice(0, 100),
      name: String(player.name || "").slice(0, 200),
    },
    reps,
    expiresAtMillis: share.expiresAt?.toMillis?.() || null,
  };
});

/** Returns 15-minute signed URLs for one permitted rep's JSON artifacts. */
exports.getAthleteSharedRepArtifacts = functions.https.onCall(async (data) => {
  const drill = String(data?.drill || "");
  const repId = String(data?.repId || "").trim();
  if (!repId || repId.includes("/")) throw athleteShareError();
  const { share } = await verifiedAthleteShare(data?.token, drill);
  const repDoc = await db
    .collection("players")
    .doc(share.playerDocId)
    .collection("reps")
    .doc(repId)
    .get();
  if (!repDoc.exists) throw athleteShareError();
  const rep = repDoc.data() || {};
  if (rep.repType !== drill && rep.drillType !== drill) {
    throw athleteShareError();
  }

  const bucket = admin.storage().bucket();
  const fileNames = ATHLETE_SHARE_ARTIFACTS[drill] || [];
  const folders = storageFolderCandidates(share.playerDocId, drill, rep);
  let selectedFolder = null;
  for (const folder of folders) {
    const [poseExists, metadataExists] = await Promise.all([
      bucket.file(`${folder}/pose.json`).exists().then(([exists]) => exists),
      bucket
        .file(`${folder}/metadata.json`)
        .exists()
        .then(([exists]) => exists),
    ]);
    if (poseExists || metadataExists) {
      selectedFolder = folder;
      break;
    }
  }
  if (!selectedFolder) return { artifactUrls: {} };

  const expires = Date.now() + ATHLETE_ARTIFACT_URL_TTL_MS;
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const file = bucket.file(`${selectedFolder}/${fileName}`);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [url] = await file.getSignedUrl({ action: "read", expires });
      return [fileName, url];
    })
  );
  return { artifactUrls: Object.fromEntries(entries.filter(Boolean)) };
});

/**
 * stripeWebhook
 *
 * Handles verified Stripe webhooks:
 * - checkout.session.completed — premium unlock (mode payment) OR subscription waitlist (mode subscription)
 * - payment_intent.succeeded — performance_test bookings (bookPerformanceTest.html)
 * - invoice.payment_succeeded / invoice.payment_failed — subscription billing (waitlist)
 * - customer.subscription.deleted — subscription cancelled (waitlist)
 *
 * Register all handled event types on this endpoint in the Stripe Dashboard.
 */

async function handleSubscriptionCheckoutCompleted(session) {
  const waitlistDocId = session.client_reference_id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!waitlistDocId || !subscriptionId) {
    console.warn(
      "Subscription checkout missing client_reference_id or subscription:",
      session.id
    );
    return;
  }
  const stripeEmail = session.customer_details?.email || null;
  await db.collection("subscriptionWaitlist").doc(waitlistDocId).update({
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: session.customer || null,
    subscriptionStatus: "trialing",
    stripeEmail: stripeEmail,
    stripeCheckoutSessionId: session.id,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Waitlist ${waitlistDocId} subscription recorded (${subscriptionId})`);
}

async function findWaitlistDocByStripeSubscriptionId(subscriptionId) {
  const snap = await db
    .collection("subscriptionWaitlist")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

async function handleInvoicePaymentSucceeded(invoice) {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return;
  // Skip $0 invoices (e.g. trial line items) — first real charge has amount_paid > 0
  if (!invoice.amount_paid || invoice.amount_paid <= 0) {
    console.log("Skipping zero-amount invoice for subscription", subId);
    return;
  }
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) {
    console.log("No waitlist doc for subscription invoice:", subId);
    return;
  }
  await doc.ref.update({
    subscriptionStatus: "active",
    firstChargedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked active after payment:", subId);
}

async function handleInvoicePaymentFailed(invoice) {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subId) return;
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) return;
  await doc.ref.update({
    subscriptionStatus: "past_due",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked past_due:", subId);
}

async function handleSubscriptionDeleted(subscription) {
  const subId = subscription.id;
  if (!subId) return;
  const doc = await findWaitlistDocByStripeSubscriptionId(subId);
  if (!doc) return;
  await doc.ref.update({
    subscriptionStatus: "cancelled",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Waitlist marked cancelled:", subId);
}

async function handlePremiumPaymentCheckoutCompleted(session) {
  const playerDocId = session.client_reference_id;
  const customerEmail = session.customer_details?.email || null;
  const amountPaid = session.amount_total ? session.amount_total / 100 : null;

  const purchaseData = {
    stripeSessionId: session.id,
    playerDocId: playerDocId || null,
    customerEmail: customerEmail,
    amountPaid: amountPaid,
    currency: session.currency || "usd",
    purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection("premiumPurchases").add(purchaseData);
    console.log("Purchase record written:", session.id);
  } catch (err) {
    console.error("Failed to write purchase record:", err);
  }

  if (playerDocId) {
    try {
      await db.collection("players").doc(playerDocId).update({
        premium_content_locked: false,
        premiumPurchasedAt: admin.firestore.FieldValue.serverTimestamp(),
        premiumStripeSessionId: session.id,
      });
      console.log(`Unlocked premium for player: ${playerDocId}`);
    } catch (err) {
      console.error(`Failed to unlock premium for player ${playerDocId}:`, err);
      throw err;
    }
  } else {
    console.log("Guest purchase (no playerDocId) — email:", customerEmail);
  }
}

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const stripeClient = stripe(functions.config().stripe.secret_key);
  const webhookSecret = functions.config().stripe.webhook_secret;

  // Verify the event came from Stripe
  let event;
  try {
    event = stripeClient.webhooks.constructEvent(
      req.rawBody, // raw buffer — required for signature verification
      req.headers["stripe-signature"],
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    if (pi.metadata && pi.metadata.booking_type === "performance_test") {
      try {
        await db.collection("performanceTestBookings").add({
          fullName: pi.metadata.fullName || null,
          email: pi.metadata.email || null,
          appointmentDate: pi.metadata.appointmentDate || null,
          timeSlot: pi.metadata.timeSlot || null,
          stripePaymentIntentId: pi.id,
          amountPaid: pi.amount_received ? pi.amount_received / 100 : null,
          currency: pi.currency || "usd",
          bookedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("Performance test booking recorded:", pi.id);
      } catch (err) {
        console.error("Failed to record performance test booking:", err);
      }
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "invoice.payment_succeeded") {
    try {
      await handleInvoicePaymentSucceeded(event.data.object);
    } catch (err) {
      console.error("handleInvoicePaymentSucceeded failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "invoice.payment_failed") {
    try {
      await handleInvoicePaymentFailed(event.data.object);
    } catch (err) {
      console.error("handleInvoicePaymentFailed failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "customer.subscription.deleted") {
    try {
      await handleSubscriptionDeleted(event.data.object);
    } catch (err) {
      console.error("handleSubscriptionDeleted failed:", err);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (
      session.mode === "subscription" &&
      session.client_reference_id &&
      session.subscription
    ) {
      try {
        await handleSubscriptionCheckoutCompleted(session);
      } catch (err) {
        console.error("handleSubscriptionCheckoutCompleted failed:", err);
        return res.status(500).send("Failed to update subscription waitlist");
      }
      return res.status(200).json({ received: true });
    }

    // One-time premium purchase (Payment Link / createPremiumCheckoutSession)
    if (session.mode === "payment") {
      try {
        await handlePremiumPaymentCheckoutCompleted(session);
      } catch (err) {
        console.error("handlePremiumPaymentCheckoutCompleted failed:", err);
        const playerDocId = session.client_reference_id;
        if (playerDocId) {
          return res.status(500).send("Failed to unlock premium");
        }
      }
      return res.status(200).json({ received: true });
    }

    console.log(
      "checkout.session.completed ignored (mode:",
      session.mode,
      ")"
    );
    return res.status(200).json({ received: true });
  }

  return res.status(200).send("Ignored event type");
});

/**
 * createPerformanceTestPaymentIntent
 *
 * HTTPS endpoint (CORS-enabled) that creates a Stripe PaymentIntent for the
 * performance-test booking page. The client mounts Stripe Payment Element with
 * the returned clientSecret — card data never touches PoseTek servers.
 *
 * Configure amount (cents): firebase functions:config:set performance_test.amount_cents="5000"
 */
exports.createPerformanceTestPaymentIntent = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const { fullName, email, appointmentDate, timeSlot } = body || {};
    if (!fullName || !email || !appointmentDate || !timeSlot) {
      return res.status(400).json({
        error: "Missing required fields: fullName, email, appointmentDate, timeSlot",
      });
    }

    const stripeClient = stripe(functions.config().stripe.secret_key);
    const amountCents = Number(
      functions.config().performance_test?.amount_cents || 5000
    );

    try {
      const paymentIntent = await stripeClient.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        receipt_email: String(email).trim(),
        metadata: {
          booking_type: "performance_test",
          fullName: String(fullName).trim().slice(0, 200),
          email: String(email).trim().slice(0, 200),
          appointmentDate: String(appointmentDate).slice(0, 50),
          timeSlot: String(timeSlot).slice(0, 50),
        },
      });

      return res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        amountCents: amountCents,
      });
    } catch (err) {
      console.error("createPerformanceTestPaymentIntent failed:", err);
      return res.status(500).json({
        error: "Could not start payment. Please try again later.",
      });
    }
  }
);

/**
 * createPremiumCheckoutSession
 *
 * Creates a Stripe Checkout Session (one-time payment) with client_reference_id = player
 * Firestore doc ID. Webhook checkout.session.completed unlocks premium (see stripeWebhook).
 *
 * Configure optional price override (cents):
 *   firebase functions:config:set premium.amount_cents="3000"
 * Public site URL for success/cancel redirects:
 *   firebase functions:config:set site.public_url="https://yourdomain.com"
 */
exports.createPremiumCheckoutSession = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const playerDocId =
      body && body.playerDocId ? String(body.playerDocId).trim() : "";
    if (!playerDocId) {
      return res.status(400).json({ error: "playerDocId required" });
    }

    let siteUrl =
      (functions.config().site && functions.config().site.public_url) ||
      "https://kickai-69dd0.web.app";
    siteUrl = siteUrl.replace(/\/$/, "");

    const amountCents = Number(
      functions.config().premium?.amount_cents || 3000
    );

    const stripeClient = stripe(functions.config().stripe.secret_key);

    const successUrl = `${siteUrl}/profile.html?userType=player&player=${encodeURIComponent(
      playerDocId
    )}&premiumCheckout=success`;
    const cancelUrl = `${siteUrl}/profile.html?userType=player&player=${encodeURIComponent(
      playerDocId
    )}&premiumCheckout=cancelled`;

    try {
      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        client_reference_id: playerDocId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "PoseTek Premium Access",
                description:
                  "Full premium analysis features for your athlete profile",
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("createPremiumCheckoutSession failed:", err);
      return res.status(500).json({
        error: "Could not start checkout. Please try again later.",
      });
    }
  }
);
