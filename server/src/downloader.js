import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { dataDir } from "./store.js";

export async function downloadVideo(video, downloadId) {
  const downloadsDir = path.join(dataDir, "downloads");
  const thumbnailsDir = path.join(dataDir, "thumbnails");
  await fs.mkdir(downloadsDir, { recursive: true });
  await fs.mkdir(thumbnailsDir, { recursive: true });

  const outputTemplate = path.join(downloadsDir, `${video.id}.%(ext)s`);
  const cookieFile = path.join(dataDir, "cache", "instagram-cookies.txt");
  const args = [
    "--no-playlist",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "-o",
    outputTemplate,
    video.sourceUrl
  ];

  try {
    await fs.access(cookieFile);
    args.unshift("--cookies", cookieFile);
  } catch {
    // Public URLs usually do not need cookies; authenticated sessions can add them later.
  }

  try {
    await runCommand("yt-dlp", args);
    const downloadedPath = await findDownloadedVideo(downloadsDir, video.id);
    return {
      status: "complete",
      outputPath: downloadedPath || path.join(downloadsDir, `${video.id}.mp4`),
      thumbnailPath: await findThumbnail(downloadsDir, video.id),
      mode: "yt-dlp"
    };
  } catch (error) {
    return {
      status: "failed",
      outputPath: null,
      thumbnailPath: video.thumbnailUrl,
      mode: "yt-dlp",
      error: error.code === "ENOENT" ? "yt-dlp is not installed or not available in PATH." : error.message
    };
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

async function findDownloadedVideo(dir, id) {
  const entries = await fs.readdir(dir);
  return entries.find((entry) => entry.startsWith(id) && /\.(mp4|mov|mkv|webm)$/i.test(entry))
    ? path.join(dir, entries.find((entry) => entry.startsWith(id) && /\.(mp4|mov|mkv|webm)$/i.test(entry)))
    : null;
}

async function findThumbnail(dir, id) {
  const entries = await fs.readdir(dir);
  const found = entries.find((entry) => entry.startsWith(id) && /\.(jpg|jpeg|png|webp)$/i.test(entry));
  return found ? path.join(dir, found) : null;
}
