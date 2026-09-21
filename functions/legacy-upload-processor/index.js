const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { logger } = require("firebase-functions");
const axios = require("axios");
const { Storage } = require("@google-cloud/storage");
const { createRepairGuard } = require("./repair-guard");
const isRepairArchive = createRepairGuard(process.env.POSETEK_REPAIR_ARCHIVES);

const storage = new Storage();
const processorURL = "https://kickai-processor-839600313930.us-west1.run.app";
const bodyScanURL = "https://kickai-bodyscan-839600313930.us-west1.run.app";
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
      logger.log("Signed URL:", signedUrl);

      await axios.post(processorURL, {
        gcs_path: filePath,
        video_url: signedUrl,
      })
      .then((res) => {
        logger.log("Processor responded with status:", res.status);
        logger.log("Processor responded with data:", res.data);
      })
      .catch((err) => {
        logger.error("Axios failed:", err.message);
        if (err.response) {
          logger.error("Response status:", err.response.status);
          logger.error("Response data:", err.response.data);
        }
      });
      logger.log("Successfully sent to processor.");
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

        logger.log("BodyScan responded:", { status: res.status, data: res.data });
      } catch (err) {
        logger.error("BodyScan request failed:", err?.message || err);
        if (err?.response) {
          logger.error("Response status:", err.response.status);
          logger.error("Response data:", err.response.data);
        }
      }

      return;
    }

    // end new code...

  } catch (err) {
    logger.error("Error sending to processor:", err);
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
