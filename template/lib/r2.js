const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const path = require("path");

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  R2_ENDPOINT
} = process.env;

const accountId = (R2_ACCOUNT_ID || "").trim();
const endpoint = (R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).trim();
const publicBase = (R2_PUBLIC_BASE_URL || "").trim();

const client = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

function safeBase(name) {
  return (name || "upload").toString().replace(/[^a-z0-9._-]/gi, "").slice(0, 64) || "upload";
}

function extFromType(contentType) {
  const map = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
  return map[contentType] || "";
}

async function uploadImage({ buffer, filename, contentType, prefix = "uploads" }) {
  if (!endpoint || !accountId || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !publicBase) {
    throw new Error("R2 not configured");
  }
  const base = publicBase.replace(/\/$/, "");
  const clean = safeBase(filename);
  const ext = path.extname(clean) || extFromType(contentType);
  const key = `${prefix}/${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return { url: `${base}/${key}`, key };
}

module.exports = { uploadImage };
