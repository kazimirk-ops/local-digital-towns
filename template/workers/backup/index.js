/**
 * Backup Worker - Database Backups to Backblaze B2
 *
 * This worker handles:
 * - Scheduled PostgreSQL database backups
 * - Encryption before upload
 * - Upload to Backblaze B2
 * - Retention policy management
 * - Backup verification
 *
 * Schedule: Nightly at 2 AM (configurable via BACKUP_SCHEDULE)
 */

require('dotenv').config();
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');

const execAsync = promisify(exec);

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APP_KEY = process.env.B2_APP_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || 'digitaltowns-backups';
const BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY;
const BACKUP_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *'; // 2 AM daily
const BACKUP_DIR = '/tmp/backups';

// Retention policy (in days)
const RETENTION = {
  daily: 7,
  weekly: 28,
  monthly: 90
};

// Check configuration
const b2Enabled = !!(B2_KEY_ID && B2_APP_KEY && B2_BUCKET_NAME);

console.log('Backup Worker Starting...');
console.log(`Backblaze B2: ${b2Enabled ? 'enabled' : 'disabled (will store locally)'}`);
console.log(`Schedule: ${BACKUP_SCHEDULE}`);

// ============ UTILITIES ============

function getBackupFilename() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toISOString().split('T')[1].replace(/:/g, '-').split('.')[0];
  const dayOfWeek = now.getDay();
  const dayOfMonth = now.getDate();

  let type = 'daily';
  if (dayOfMonth === 1) type = 'monthly';
  else if (dayOfWeek === 0) type = 'weekly';

  return {
    filename: `backup-${type}-${date}-${time}.sql.gz.enc`,
    type,
    date
  };
}

async function ensureBackupDir() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Encrypt file using AES-256-GCM
async function encryptFile(inputPath, outputPath) {
  if (!BACKUP_ENCRYPTION_KEY) {
    // No encryption, just copy
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  const key = crypto.scryptSync(BACKUP_ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const input = await fs.readFile(inputPath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV (16 bytes) + AuthTag (16 bytes) + Encrypted data
  const output = Buffer.concat([iv, authTag, encrypted]);
  await fs.writeFile(outputPath, output);
}

// ============ POSTGRESQL BACKUP ============

async function createBackup() {
  await ensureBackupDir();
  const { filename, type, date } = getBackupFilename();

  const sqlPath = path.join(BACKUP_DIR, `backup-${date}.sql`);
  const gzPath = path.join(BACKUP_DIR, `backup-${date}.sql.gz`);
  const encPath = path.join(BACKUP_DIR, filename);

  console.log(`Creating ${type} backup: ${filename}`);

  try {
    // Create pg_dump
    console.log('Running pg_dump...');
    await execAsync(`pg_dump "${DATABASE_URL}" > "${sqlPath}"`);

    // Compress
    console.log('Compressing...');
    await execAsync(`gzip -f "${sqlPath}"`);

    // Encrypt
    console.log('Encrypting...');
    await encryptFile(gzPath, encPath);

    // Get file size
    const stats = await fs.stat(encPath);
    console.log(`Backup created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Cleanup unencrypted file
    await fs.unlink(gzPath).catch(() => {});

    return { path: encPath, filename, type, size: stats.size };
  } catch (err) {
    console.error('Backup creation failed:', err);
    throw err;
  }
}

// ============ BACKBLAZE B2 UPLOAD ============

async function getB2AuthToken() {
  const credentials = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64');

  const response = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${credentials}`
    }
  });

  if (!response.ok) {
    throw new Error('B2 authorization failed');
  }

  return response.json();
}

async function getB2UploadUrl(authToken, apiUrl, bucketId) {
  const response = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      'Authorization': authToken
    },
    body: JSON.stringify({ bucketId })
  });

  if (!response.ok) {
    throw new Error('Failed to get upload URL');
  }

  return response.json();
}

async function uploadToB2(filePath, filename) {
  if (!b2Enabled) {
    console.log('B2 not configured, backup stored locally:', filePath);
    return { local: true, path: filePath };
  }

  console.log('Uploading to Backblaze B2...');

  try {
    // Authorize
    const auth = await getB2AuthToken();

    // Get bucket ID
    const bucketsResponse = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
      method: 'POST',
      headers: {
        'Authorization': auth.authorizationToken
      },
      body: JSON.stringify({
        accountId: auth.accountId,
        bucketName: B2_BUCKET_NAME
      })
    });

    const bucketsData = await bucketsResponse.json();
    const bucket = bucketsData.buckets?.find(b => b.bucketName === B2_BUCKET_NAME);

    if (!bucket) {
      throw new Error(`Bucket not found: ${B2_BUCKET_NAME}`);
    }

    // Get upload URL
    const uploadData = await getB2UploadUrl(auth.authorizationToken, auth.apiUrl, bucket.bucketId);

    // Read file
    const fileData = await fs.readFile(filePath);
    const sha1 = crypto.createHash('sha1').update(fileData).digest('hex');

    // Upload
    const uploadResponse = await fetch(uploadData.uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': uploadData.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(filename),
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileData.length,
        'X-Bz-Content-Sha1': sha1
      },
      body: fileData
    });

    if (!uploadResponse.ok) {
      throw new Error('Upload failed');
    }

    const result = await uploadResponse.json();
    console.log('Upload complete:', result.fileName);

    // Cleanup local file
    await fs.unlink(filePath).catch(() => {});

    return {
      fileId: result.fileId,
      fileName: result.fileName,
      size: result.contentLength
    };
  } catch (err) {
    console.error('B2 upload error:', err);
    throw err;
  }
}

// ============ RETENTION MANAGEMENT ============

async function cleanupOldBackups() {
  if (!b2Enabled) {
    console.log('Skipping B2 cleanup (not configured)');
    return;
  }

  console.log('Cleaning up old backups...');

  try {
    const auth = await getB2AuthToken();

    // List files
    const listResponse = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        'Authorization': auth.authorizationToken
      },
      body: JSON.stringify({
        bucketId: auth.allowed.bucketId,
        maxFileCount: 1000
      })
    });

    const files = await listResponse.json();
    const now = new Date();

    for (const file of files.files || []) {
      const match = file.fileName.match(/backup-(daily|weekly|monthly)-(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;

      const [, type, dateStr] = match;
      const fileDate = new Date(dateStr);
      const ageDays = (now - fileDate) / (1000 * 60 * 60 * 24);

      const maxAge = RETENTION[type] || RETENTION.daily;

      if (ageDays > maxAge) {
        console.log(`Deleting old ${type} backup: ${file.fileName} (${Math.floor(ageDays)} days old)`);

        await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
          method: 'POST',
          headers: {
            'Authorization': auth.authorizationToken
          },
          body: JSON.stringify({
            fileId: file.fileId,
            fileName: file.fileName
          })
        });
      }
    }

    console.log('Cleanup complete');
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// ============ MAIN BACKUP JOB ============

async function runBackup() {
  console.log('='.repeat(50));
  console.log(`Backup started: ${new Date().toISOString()}`);
  console.log('='.repeat(50));

  try {
    // Create backup
    const backup = await createBackup();

    // Upload to B2
    const uploadResult = await uploadToB2(backup.path, backup.filename);

    // Cleanup old backups
    await cleanupOldBackups();

    console.log('='.repeat(50));
    console.log('Backup completed successfully');
    console.log(`Type: ${backup.type}`);
    console.log(`Size: ${(backup.size / 1024 / 1024).toFixed(2)} MB`);
    console.log('='.repeat(50));

    return { success: true, backup, upload: uploadResult };
  } catch (err) {
    console.error('='.repeat(50));
    console.error('Backup FAILED:', err.message);
    console.error('='.repeat(50));

    return { success: false, error: err.message };
  }
}

// ============ SCHEDULER ============

// Schedule backup job
cron.schedule(BACKUP_SCHEDULE, async () => {
  await runBackup();
});

console.log(`Backup worker ready. Next backup scheduled per cron: ${BACKUP_SCHEDULE}`);

// Run immediately if RUN_NOW is set (useful for testing)
if (process.env.RUN_NOW === 'true') {
  console.log('Running backup immediately (RUN_NOW=true)...');
  runBackup().then(() => {
    if (process.env.EXIT_AFTER_RUN === 'true') {
      process.exit(0);
    }
  });
}

// Keep process alive
setInterval(() => {
  console.log(`Backup worker alive: ${new Date().toISOString()}`);
}, 60 * 60 * 1000); // Log every hour
