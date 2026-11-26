// The R2 multipart client for the upload routes/actions (server only): same R2_* env names as the worker.
import { r2StorageFromEnv, type MultipartStorage } from "@autopilot/media/src/storage.js";

export function uploadStorage(): MultipartStorage | null {
  return r2StorageFromEnv(process.env);
}
