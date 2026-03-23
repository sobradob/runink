/**
 * File storage for poster PNGs using Cloudflare R2 (S3-compatible).
 * Falls back to local file storage in development.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const R2_CONFIGURED = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY
);

let s3Client: S3Client | null = null;
const BUCKET = process.env.R2_BUCKET || 'runink-posters';

if (R2_CONFIGURED) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

// Local fallback directory
const LOCAL_DIR = path.resolve(__dirname, '../../data/uploads');

/**
 * Get a pre-signed upload URL for the frontend to upload a poster PNG.
 */
export async function getUploadUrl(key: string): Promise<{ url: string; method: 'PUT' | 'POST'; local: boolean }> {
  if (s3Client) {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: 'image/png',
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url, method: 'PUT', local: false };
  }

  // Local fallback: return a local endpoint
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  return {
    url: `/api/upload/${key}`,
    method: 'PUT',
    local: true,
  };
}

/**
 * Get the public URL for a stored poster PNG.
 */
export function getPublicUrl(key: string): string {
  if (R2_CONFIGURED && process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  // Local fallback
  return `/uploads/${key}`;
}

/**
 * Store a file locally (development fallback).
 */
export function storeLocal(key: string, data: Buffer): string {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const filePath = path.join(LOCAL_DIR, key);
  // Ensure subdirectories exist
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
  return `/uploads/${key}`;
}

/**
 * Get the local file path for serving.
 */
export function getLocalPath(key: string): string {
  return path.join(LOCAL_DIR, key);
}

export { LOCAL_DIR };
