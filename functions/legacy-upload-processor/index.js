const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { logger } = require("firebase-functions");
const axios = require("axios");
const { Storage } = require("@google-cloud/storage");
const { createRepairGuard } = require("./repair-guard");
const isRepairArchive = createRepairGuard(process.env.POSETEK_REPAIR_ARCHIVES);

const storage = new Storage();
const processorURL = "https://kickai-processor-839600313930.us-west1.run.app";
const bodyScanURL = "https://kickai-bodyscan-839600313930.us-west1.run.app";
const locallyProcessedDrills = new Set(["deadballShot", "sprint", "jump", "broadJump", "changeOfDirection", "dribbling"]);
// const processorURL = "https://kickai-processor-keycy7dkua-uc.a.run.app"

function isLocallyProcessed(object) {
  const value = object?.metadata?.posetekLocalProcessed;
  return typeof value === "string" && value.toLowerCase() === "true";
}

exports.onVideoUpload = onObjectFinalized({ region: "us-west1" }, async (event) => {
  try {
    if (isLocallyProcessed(event.data)) {
      logger.log("On-device processed video skipped; no legacy processing requested.", {
        bucket: event.data.bucket,
        name: event.data.name,
        generation: event.data.generation,
      });
      return;
    }
    if (isRepairArchive(event.data)) {
      logger.log("Archived repair object skipped; no processing requested.", {
        bucket: event.data.bucket,
        name: event.data.name,
        generation: event.data.generation,
      });
      return;
    }
    const bucketName = event.data.bucket;
    const filePath = event.data.name;

    // Native processing has already written this attempt and its artifacts.
    // Retain its video for playback without creating a second cloud result.
    // This marker is routing metadata, never an authorization decision. Free
    // Record, diagnostic bundles and unmarked legacy uploads keep their route.
    const segments = typeof filePath === "string" ? filePath.split("/") : [];
    if (event.data.metadata?.posetekLocalProcessed === "true"
      && event.data.metadata?.posetekContextVersion === "1"
      && /^[A-Za-z0-9_-]{1,128}$/.test(segments[0] || "")
      && locallyProcessedDrills.has(segments[1])
      && /^session[1-9]\d*$/.test(segments[2] || "")
      && /^kick[1-9]\d*$/.test(segments[3] || "")
      && /\.mov$/i.test(filePath)) {
      logger.log("Native recording archived; no cloud processing requested.", {
        bucket: bucketName, name: filePath, generation: event.data.generation,
      });
      return;
    }

    // 🛑 Skip if not a .mov (or not a video)
    if (filePath.endsWith('mov')) {
      logger.log('found video object:', filePath);
      logger.log("bucket name:", bucketName);

      // Generate a signed URL (valid for 5 minutes)
      const [signedUrl] = await storage
        .bucket(bucketName)
        .file(filePath)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 5 * 60 * 1000, // 5 minutes
        });

      logger.log("Sending video to processor:", filePath);
      try {
        const res = await axios.post(processorURL, { gcs_path: filePath, video_url: signedUrl });
        logger.log("Processor responded with status:", res.status);
      } catch (err) {
        // Do not claim delivery or introduce event retries: the legacy
        // processor has no verified idempotent request contract.
        logger.error("Video processor request failed.", { status: err?.response?.status || null, code: err?.code || null });
      }
      return;
    }

    // if the object is named bodyScan.png, then send to the body scan processor...

    const lower = filePath.toLowerCase();
    const isBodyScanPng = lower.endsWith("bodyscan.png");

    if (isBodyScanPng) {
      logger.log("Found body scan image:", filePath);

      // Signed URL valid for 5 minutes
      const [signedUrl] = await storage.bucket(bucketName).file(filePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 5 * 60 * 1000,
      });

      logger.log("Sending body scan image to bodyScan processor:", filePath);

      try {
        const res = await axios.post(bodyScanURL, {
          gcs_path: filePath,
          video_url: signedUrl,
          bucket: bucketName,
        });

        logger.log("BodyScan responded:", { status: res.status });
      } catch (err) {
        logger.error("BodyScan request failed.", { status: err?.response?.status || null, code: err?.code || null });
      }

      return;
    }

    // end new code...

  } catch (err) {
    logger.error("Upload processor could not route the object.", { code: err?.code || null });
  }
});

// exports.onVideoUpload = onObjectFinalized(
//   { region: "us-west1" },
//   async (event) => {
//     logger.log("Cloud processing disabled; skipping trigger.", {
//       bucket: event.data.bucket,
//       name: event.data.name,
//     });
//     return;
//   }
// );
// logger.log('just skip the cloud processing for now.')
