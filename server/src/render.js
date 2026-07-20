import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { dataDir } from "./store.js";

const CANVAS = { width: 1080, height: 1920 };

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.split("\n").slice(-6).join(" ") || `ffmpeg exited ${code}`))));
  });
}

async function safeUnlink(file) {
  if (!file) return;
  try {
    await fs.rm(file, { force: true });
  } catch {
    // ignore
  }
}

// Some reels ship without an audio track. Detect it so we can substitute a
// silent track — otherwise the outro concat's [0:a] filter has no stream to bind.
function probeHasAudio(file) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(out.trim().length > 0));
  });
}

// Probe container duration (seconds). Lets us bound the output with -t so the
// looping template/overlay/silent-audio inputs can never run forever.
function probeDuration(file) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const value = parseFloat(out.trim());
      resolve(Number.isFinite(value) ? value : 0);
    });
  });
}

async function writeOverlayPng(dataUrl, id, tempDir) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) return null;
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!base64) return null;
  const file = path.join(tempDir, `overlay-${id}-${Date.now()}.png`);
  await fs.writeFile(file, Buffer.from(base64, "base64"));
  return file;
}

// Frame a video into a box (Bw x Bh) as a set of filters producing outLabel.
// The FULL frame is cover-scaled to the box, then scaled by zoom: z=1 fills the
// box (crop overflow), z>1 crops in, z<1 shows MORE of the video with padding
// (transparent, so the template shows through). alignX/alignY in -2..2 position
// it (0 = center, -1 = flush left/top, beyond ±1 pushes it partly off-frame).
function framedVideoFilters(inputIdx, box, zoom, alignX, alignY, outLabel) {
  const Bw = Math.round(box.w);
  const Bh = Math.round(box.h);
  const z = clamp(num(zoom, 1), 0.3, 4);
  const ax = clamp(num(alignX, 0), -2, 2);
  const ay = clamp(num(alignY, 0), -2, 2);
  const scv = `scv${inputIdx}`;
  const base = `bxb${inputIdx}`;
  return [
    `[${inputIdx}:v]scale=${Bw}:${Bh}:force_original_aspect_ratio=increase,scale=trunc(iw*${z}/2)*2:trunc(ih*${z}/2)*2,setsar=1[${scv}]`,
    `color=c=black@0.0:s=${Bw}x${Bh}:r=30,format=rgba[${base}]`,
    `[${base}][${scv}]overlay=x='(W-w)/2*(1+${ax})':y='(H-h)/2*(1+${ay})':format=auto[${scv}o]`,
    `[${scv}o]setsar=1${outLabel}`
  ];
}

// Single-pass composite: [template bg] -> [video framed into content box] ->
// [text overlay PNG on top]. Any layer is optional. Produces a file with audio.
async function renderComposite({ templatePath, baseFile, skipOriginal, videoHasAudio, trimStart, box, zoom, alignX, alignY, overlayPng, durationSec, output }) {
  const args = [];
  let idx = 0;
  let tIdx = -1;
  let vIdx = -1;
  let oIdx = -1;

  if (templatePath) {
    args.push("-loop", "1", "-i", templatePath);
    tIdx = idx++;
  }
  const hasVideo = Boolean(baseFile) && !skipOriginal;
  if (hasVideo) {
    if (trimStart > 0) args.push("-ss", String(trimStart));
    args.push("-i", baseFile);
    vIdx = idx++;
  }
  if (overlayPng) {
    args.push("-loop", "1", "-i", overlayPng);
    oIdx = idx++;
  }
  // Guarantee a background if there is neither a template nor a base video.
  if (tIdx < 0 && vIdx < 0) {
    args.push("-f", "lavfi", "-i", `color=c=black:s=${CANVAS.width}x${CANVAS.height}:r=30`);
    tIdx = idx++;
  }
  // Guarantee an audio track: use the reel's audio if present, otherwise a silent
  // source, so the segment always exports one audio stream for later concat.
  const useVideoAudio = hasVideo && videoHasAudio;
  let aIdx = -1;
  if (!useVideoAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
    aIdx = idx++;
  }

  const filters = [];
  let last = null;
  if (tIdx >= 0) {
    filters.push(`[${tIdx}:v]scale=${CANVAS.width}:${CANVAS.height},setsar=1[bg]`);
    last = "[bg]";
  }
  if (vIdx >= 0) {
    const useBox = box || { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height };
    filters.push(...framedVideoFilters(vIdx, useBox, zoom, alignX, alignY, "[vid]"));
    if (last) {
      filters.push(`${last}[vid]overlay=${Math.round(useBox.x)}:${Math.round(useBox.y)}[comp]`);
      last = "[comp]";
    } else {
      last = "[vid]";
    }
  }
  if (oIdx >= 0) {
    filters.push(`${last}[${oIdx}:v]overlay=0:0[outv]`);
    last = "[outv]";
  } else {
    filters.push(`${last}null[outv]`);
    last = "[outv]";
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[outv]");
  args.push("-map", useVideoAudio ? `${vIdx}:a` : `${aIdx}:a`);

  // Always bound the output explicitly: the template/overlay/silent-audio inputs
  // loop forever, so -t (from the probed/trimmed duration) is what ends the clip.
  args.push("-t", String(durationSec));

  args.push(
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-movflags", "+faststart",
    output
  );
  await runFfmpeg(args);
}

const PAD_TO_CANVAS = `scale=${CANVAS.width}:${CANVAS.height}:force_original_aspect_ratio=decrease,pad=${CANVAS.width}:${CANVAS.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

async function normalizeOutro(file, output) {
  await runFfmpeg([
    "-i", file,
    "-filter_complex", `[0:v]${PAD_TO_CANVAS}[v]`,
    "-map", "[v]", "-map", "0:a?",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-movflags", "+faststart",
    output
  ]);
}

async function renderBlackOutro(durationSec, output) {
  await runFfmpeg([
    "-f", "lavfi", "-t", String(durationSec), "-i", `color=c=black:s=${CANVAS.width}x${CANVAS.height}:r=30`,
    "-f", "lavfi", "-t", String(durationSec), "-i", "anullsrc=r=44100:cl=stereo",
    "-map", "0:v", "-map", "1:a",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    output
  ]);
}

// Concatenate the main segment and the outro. Base audio is padded with silence
// across the outro so the reel's sound is preserved through the tail.
async function concatWithOutro({ mainFile, outroFile, output }) {
  await runFfmpeg([
    "-i", mainFile,
    "-i", outroFile,
    "-filter_complex", `[0:v][1:v]concat=n=2:v=1:a=0[outv];[0:a]apad[outa]`,
    "-map", "[outv]", "-map", "[outa]",
    "-shortest",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-movflags", "+faststart",
    output
  ]);
}

// project may carry: trimStart, trimEnd (float seconds), skipOriginal (bool),
// zoom (0.3..4; <1 shows more of the video with padding), panX/panY
// (percent, -200..200 -> directional framing, beyond ±100 pushes off-frame),
// overlayImage (data URL of text layers), templatePath (image background) +
// contentBox ({x,y,w,h} on the 1080x1920 canvas where the video sits), and
// outro ({ enabled, localPath?, durationSec? }).
export async function renderProject(project) {
  const outputDir = path.join(dataDir, "renders");
  const tempDir = path.join(dataDir, "temp");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  // renderId (per export job) keeps each export's file distinct; fall back to
  // the project id for direct/standalone renders.
  const outName = project.renderId || project.id;
  const output = path.join(outputDir, `${outName}.mp4`);

  const skipOriginal = Boolean(project.skipOriginal);
  const baseClip = skipOriginal ? null : (project.clips || []).find((clip) => clip?.localPath);
  const templatePath = project.templatePath || null;
  const box = project.contentBox || null;

  const outroConfig = project.outro && (project.outro.enabled || project.outro.localPath)
    ? { localPath: project.outro.localPath || null, durationSec: Math.max(0.5, num(project.outro.durationSec, 2)) }
    : null;

  const trimStart = Math.max(0, num(project.trimStart, 0));
  const trimEndRaw = project.trimEnd === null || project.trimEnd === undefined ? null : num(project.trimEnd, null);
  const trimDuration = trimEndRaw !== null && trimEndRaw > trimStart ? trimEndRaw - trimStart : null;

  const overlayPng = await writeOverlayPng(project.overlayImage, outName, tempDir);

  if (!baseClip?.localPath && !outroConfig && !overlayPng && !templatePath) {
    await safeUnlink(overlayPng);
    return {
      outputPath: output,
      mode: "mock",
      note: skipOriginal ? "Original reel skipped and no template/overlay/outro provided." : "No local media attached yet.",
      trimStart,
      trimEnd: trimEndRaw
    };
  }

  const zoom = clamp(num(project.zoom, 1), 0.3, 4);
  const alignX = clamp(num(project.panX, 0) / 100, -2, 2);
  const alignY = clamp(num(project.panY, 0) / 100, -2, 2);
  const videoHasAudio = baseClip?.localPath && !skipOriginal ? await probeHasAudio(baseClip.localPath) : false;
  const videoDuration = baseClip?.localPath && !skipOriginal ? await probeDuration(baseClip.localPath) : 0;
  // Bounded segment length: honor the trim window, else play from trimStart to
  // the end of the clip; fall back to 3s when we can't probe.
  const available = videoDuration > trimStart ? videoDuration - trimStart : videoDuration;
  let segDuration;
  if (skipOriginal) segDuration = trimDuration || 3;
  else if (trimDuration !== null) segDuration = available > 0 ? Math.min(trimDuration, available) : trimDuration;
  else segDuration = available > 0 ? available : 3;
  const tempFiles = [];

  try {
    const needsOutro = Boolean(outroConfig);
    const mainFile = needsOutro ? path.join(tempDir, `main-${outName}-${Date.now()}.mp4`) : output;
    if (needsOutro) tempFiles.push(mainFile);

    await renderComposite({
      templatePath,
      baseFile: baseClip?.localPath || null,
      skipOriginal,
      videoHasAudio,
      trimStart,
      box,
      zoom,
      alignX,
      alignY,
      overlayPng,
      durationSec: segDuration,
      output: mainFile
    });

    if (needsOutro) {
      const outroNorm = path.join(tempDir, `outro-${outName}-${Date.now()}.mp4`);
      tempFiles.push(outroNorm);
      if (outroConfig.localPath) {
        await normalizeOutro(outroConfig.localPath, outroNorm);
      } else {
        await renderBlackOutro(outroConfig.durationSec, outroNorm);
      }
      await concatWithOutro({ mainFile, outroFile: outroNorm, output });
    }

    return {
      outputPath: output,
      mode: [
        templatePath ? "template" : null,
        baseClip?.localPath && !skipOriginal ? "video" : null,
        overlayPng ? "text" : null,
        needsOutro ? "outro" : null
      ].filter(Boolean).join("+") || "empty",
      trimStart,
      trimEnd: trimEndRaw,
      zoom,
      overlay: Boolean(overlayPng),
      template: Boolean(templatePath),
      outro: needsOutro
    };
  } finally {
    await Promise.all(tempFiles.map(safeUnlink));
    await safeUnlink(overlayPng);
  }
}
