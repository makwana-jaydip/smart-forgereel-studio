import path from "node:path";
import fs from "node:fs/promises";
import { dataDir, mutateStore } from "./store.js";

const HOUR_MS = 60 * 60 * 1000;

export const RETENTION_HOURS = Math.max(1, Number(process.env.RETENTION_HOURS || 6));

function isExpired(timestamp, cutoff) {
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  return !time || time < cutoff;
}

async function removeFile(filePath) {
  if (!filePath) return;
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Best-effort: a missing file is already the desired state.
  }
}

// Working-media folders that are swept so the app's disk footprint never grows.
// Templates (reusable config) and cache/fonts/autosave are intentionally excluded.
const SWEEP_DIRS = ["downloads", "uploads", "renders", "exports", "thumbnails", "temp"];

// Deletes any file in the working-media folders older than the retention window,
// catching orphans (multer temp files, stale thumbnails, reusable outro tails)
// so product size stays bounded even if a DB record was already dropped.
async function purgeOrphanFiles(cutoff) {
  let removed = 0;
  for (const dir of SWEEP_DIRS) {
    const full = path.join(dataDir, dir);
    let entries;
    try {
      entries = await fs.readdir(full);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(full, entry);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fs.rm(filePath, { force: true });
          removed += 1;
        }
      } catch {
        // Ignore files that vanish mid-sweep.
      }
    }
  }
  return removed;
}

// Removes fetched reels, downloaded reel media, uploaded media, exported renders,
// and stale projects once they pass the retention window, then deletes any leftover
// files on disk. Nothing accumulates — only reusable templates persist.
export async function purgeExpired(retentionHours = RETENTION_HOURS, logger = null) {
  const cutoff = Date.now() - retentionHours * HOUR_MS;
  const filesToRemove = [];
  const summary = { videos: 0, downloads: 0, assets: 0, renderJobs: 0, projects: 0, files: 0 };

  await mutateStore((db) => {
    const keptVideos = db.videos.filter((video) => !isExpired(video.createdAt, cutoff));
    summary.videos = db.videos.length - keptVideos.length;
    db.videos = keptVideos;

    const keptDownloads = db.downloads.filter((download) => {
      if (isExpired(download.createdAt, cutoff)) {
        if (download.outputPath) filesToRemove.push(download.outputPath);
        return false;
      }
      return true;
    });
    summary.downloads = db.downloads.length - keptDownloads.length;
    db.downloads = keptDownloads;

    // All media assets expire — downloaded reels AND the user's own uploads — so
    // the library never becomes permanent storage.
    const keptAssets = db.assets.filter((asset) => {
      if (isExpired(asset.createdAt, cutoff)) {
        if (asset.localPath) filesToRemove.push(asset.localPath);
        return false;
      }
      return true;
    });
    summary.assets = db.assets.length - keptAssets.length;
    db.assets = keptAssets;

    const keptJobs = db.renderJobs.filter((job) => {
      if (isExpired(job.completedAt || job.createdAt, cutoff)) {
        if (job.result?.outputPath) filesToRemove.push(job.result.outputPath);
        return false;
      }
      return true;
    });
    summary.renderJobs = db.renderJobs.length - keptJobs.length;
    db.renderJobs = keptJobs;

    // Projects use updatedAt so active editing resets the clock (resume-friendly).
    const keptProjects = db.projects.filter((project) => !isExpired(project.updatedAt || project.createdAt, cutoff));
    summary.projects = db.projects.length - keptProjects.length;
    db.projects = keptProjects;
  });

  await Promise.all(filesToRemove.map(removeFile));
  summary.files = await purgeOrphanFiles(cutoff);

  const total = Object.values(summary).reduce((sum, value) => sum + value, 0);
  if (total && logger?.info) logger.info({ summary, retentionHours }, "Retention sweep removed expired items");
  return summary;
}
