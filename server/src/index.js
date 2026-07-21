import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import pino from "pino";
import pinoHttp from "pino-http";
import { z } from "zod";
import { discoverInstagramVideos } from "./instagram.js";
import { dataDir, ensureStore, makeId, mutateStore, readStore } from "./store.js";
import { renderProject } from "./render.js";
import { downloadVideo } from "./downloader.js";
import { purgeExpired, RETENTION_HOURS } from "./retention.js";
import {
  defaultsDir,
  defaultOutro,
  ensureDefaultTemplates,
  getDefaultsStatus,
  resolveDefaultTemplateId
} from "./defaults.js";

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "127.0.0.1";
const upload = multer({ dest: path.join(dataDir, "uploads") });

const configuredOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const allowLocalNetwork = process.env.ALLOW_LOCAL_NETWORK !== "false";
const localNetworkPattern = /^https?:\/\/(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?$/;

function isAllowedOrigin(origin) {
  if (configuredOrigins.includes(origin)) return true;
  if (allowLocalNetwork && localNetworkPattern.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    }
  })
);
app.use(express.json({ limit: "20mb" }));
app.use("/storage", express.static(dataDir));
app.use("/defaults", express.static(defaultsDir));
app.use(pinoHttp({ logger }));

// Wraps async route handlers so thrown/rejected errors reach the error
// middleware instead of crashing the process with an unhandled rejection.
const ah = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const AccountSchema = z
  .object({
    handle: z
      .string()
      .transform((value) => value.replace(/^@/, "").trim())
      .optional()
      .default(""),
    mode: z.enum(["live", "session", "urls", "mock"]).default("live"),
    urls: z.array(z.string().url()).default([])
  })
  .refine((value) => value.handle.length > 0 || value.urls.length > 0, {
    message: "Provide an account handle or at least one reel URL"
  });

function deriveHandle(input) {
  if (input.handle) return input.handle;
  return "manual-reels";
}

// Chooses the discovery adapter: pasted URLs win, otherwise a real handle is
// scraped live (no cookies), and "mock" stays mock for offline/demo use.
function resolveMode(input) {
  if (input.urls.length) return "urls";
  if (input.mode === "mock") return "mock";
  return "live";
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/config", ah(async (_req, res) => {
  const db = await readStore();
  const assets = await getDefaultsStatus(db);
  res.json({ retentionHours: RETENTION_HOURS, ...assets });
}));

app.get("/api/dashboard", ah(async (_req, res) => {
  const db = await readStore();
  res.json({
    totals: {
      projects: db.projects.length,
      downloadedVideos: db.assets.length,
      exportQueue: db.renderJobs.filter((job) => ["queued", "rendering"].includes(job.status)).length,
      templates: db.templates.length
    },
    recentProjects: db.projects.slice(0, 5),
    recentDownloads: db.assets.slice(0, 6),
    exportProgress: db.renderJobs.slice(0, 6)
  });
}));

app.get("/api/users", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.users);
}));

app.post("/api/auth/instagram-session", upload.single("cookies"), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a Netscape-format cookies.txt file." });
  const target = path.join(dataDir, "cache", "instagram-cookies.txt");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(req.file.path, target);
  res.status(201).json({ ok: true, cookieFile: "storage/cache/instagram-cookies.txt" });
}));

app.post("/api/users", ah(async (req, res) => {
  const schema = z.object({ name: z.string().min(1), email: z.string().email() });
  const input = schema.parse(req.body);
  const user = {
    id: makeId("usr"),
    ...input,
    preferences: { theme: "dark", language: "en" },
    createdAt: new Date().toISOString()
  };
  await mutateStore((db) => db.users.unshift(user));
  res.status(201).json(user);
}));

app.patch("/api/users/:id", ah(async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    preferences: z
      .object({
        theme: z.enum(["dark", "light"]).optional(),
        language: z.string().min(2).max(10).optional()
      })
      .optional()
  });
  const patch = schema.parse(req.body);
  const user = await mutateStore((db) => {
    const index = db.users.findIndex((item) => item.id === req.params.id);
    if (index === -1) return null;
    const current = db.users[index];
    db.users[index] = {
      ...current,
      ...patch,
      preferences: patch.preferences ? { ...current.preferences, ...patch.preferences } : current.preferences
    };
    return db.users[index];
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
}));

app.delete("/api/users/:id", ah(async (req, res) => {
  const existed = await mutateStore((db) => {
    const before = db.users.length;
    db.users = db.users.filter((item) => item.id !== req.params.id);
    return before !== db.users.length;
  });
  if (!existed) return res.status(404).json({ error: "User not found" });
  res.status(204).end();
}));

app.get("/api/accounts", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.accounts);
}));

app.post("/api/accounts", ah(async (req, res) => {
  const input = AccountSchema.parse(req.body);
  const account = {
    id: makeId("acct"),
    ...input,
    handle: deriveHandle(input),
    mode: resolveMode(input),
    createdAt: new Date().toISOString()
  };
  await mutateStore((db) => db.accounts.unshift(account));
  res.status(201).json(account);
}));

app.patch("/api/accounts/:id", ah(async (req, res) => {
  const schema = z.object({
    handle: z.string().transform((value) => value.replace(/^@/, "").trim()).optional(),
    mode: z.enum(["live", "session", "urls", "mock"]).optional(),
    urls: z.array(z.string().url()).optional()
  });
  const patch = schema.parse(req.body);
  const account = await mutateStore((db) => {
    const index = db.accounts.findIndex((item) => item.id === req.params.id);
    if (index === -1) return null;
    const next = { ...db.accounts[index], ...patch };
    if (next.urls?.length) {
      next.mode = "urls";
    } else if (patch.urls !== undefined && !next.urls.length && next.mode === "urls") {
      next.mode = "live";
    }
    if (next.handle === "") next.handle = "manual-reels";
    db.accounts[index] = next;
    return db.accounts[index];
  });
  if (!account) return res.status(404).json({ error: "Account not found" });
  res.json(account);
}));

app.delete("/api/accounts", ah(async (_req, res) => {
  await mutateStore((db) => {
    db.accounts = [];
    db.videos = [];
  });
  res.status(204).end();
}));

app.delete("/api/accounts/:id", ah(async (req, res) => {
  const existed = await mutateStore((db) => {
    const before = db.accounts.length;
    db.accounts = db.accounts.filter((item) => item.id !== req.params.id);
    db.videos = db.videos.filter((video) => video.accountId !== req.params.id);
    return before !== db.accounts.length;
  });
  if (!existed) return res.status(404).json({ error: "Account not found" });
  res.status(204).end();
}));

app.post("/api/discover", ah(async (req, res) => {
  const limit = req.body?.limit ? Number(req.body.limit) : undefined;
  const db = await readStore();
  const accountIds = req.body.accountIds?.length ? req.body.accountIds : db.accounts.map((item) => item.id);
  const accounts = db.accounts.filter((item) => accountIds.includes(item.id));

  // Fetch every account independently so one flaky/private account does not
  // wipe out the results from the others.
  const errors = [];
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      try {
        return await discoverInstagramVideos(account, limit);
      } catch (error) {
        logger.warn({ account: account.handle, error: error.message }, "Discovery failed for account");
        errors.push({ handle: account.handle, message: error.message });
        return [];
      }
    })
  );
  const discovered = perAccount.flat();

  await mutateStore((next) => {
    const fetchedAccountIds = new Set(accounts.map((item) => item.id));
    next.videos = [
      ...discovered,
      ...next.videos.filter(
        (video) =>
          !fetchedAccountIds.has(video.accountId) &&
          !discovered.some((fresh) => fresh.sourceUrl === video.sourceUrl)
      )
    ];
  });

  const dbAfter = await readStore();
  const videos = dbAfter.videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ videos, errors });
}));

app.get("/api/videos", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
}));

app.delete("/api/videos", ah(async (_req, res) => {
  await mutateStore((db) => {
    db.videos = [];
  });
  res.status(204).end();
}));

// Wipes all working content (fetched videos, downloads, library assets,
// projects, and export jobs) plus their files, for a clean fresh start.
// Accounts, users, and the default template are kept.
app.post("/api/maintenance/reset-content", ah(async (_req, res) => {
  const wipeDirs = ["downloads", "uploads", "renders", "exports", "thumbnails", "temp", "autosave"];
  for (const dir of wipeDirs) {
    const target = path.join(dataDir, dir);
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(target, { recursive: true }).catch(() => {});
  }
  await mutateStore((db) => {
    db.videos = [];
    db.downloads = [];
    db.assets = [];
    db.projects = [];
    db.renderJobs = [];
    db.templates = db.templates.filter((item) => item.default === true);
  });
  res.json({ ok: true, cleared: ["videos", "downloads", "assets", "projects", "renderJobs"] });
}));

app.post("/api/downloads", ah(async (req, res) => {
  const schema = z.object({ videoIds: z.array(z.string()).min(1) });
  const { videoIds } = schema.parse(req.body);
  const db = await readStore();
  const videos = db.videos.filter((video) => videoIds.includes(video.id));
  const now = new Date().toISOString();
  const results = await Promise.all(videos.map(async (video) => {
    const id = makeId("dl");
    const result = await downloadVideo(video, id);
    const download = {
      id,
      videoId: video.id,
      status: result.status,
      retries: 0,
      sourceUrl: video.sourceUrl,
      outputPath: result.outputPath,
      thumbnailPath: result.thumbnailPath || video.thumbnailUrl,
      error: result.error,
      createdAt: now,
      completedAt: result.status === "complete" ? new Date().toISOString() : null
    };
    const asset = result.status === "complete" ? {
      id: makeId("asset"),
      videoId: video.id,
      type: "video",
      filename: path.basename(result.outputPath),
      localPath: result.outputPath,
      previewUrl: toStorageUrl(result.outputPath),
      thumbnailUrl: toStorageUrl(result.thumbnailPath) || video.thumbnailUrl,
      durationSec: video.durationSec,
      resolution: "1080x1920",
      fileSizeMb: Number((18 + video.durationSec * 1.7).toFixed(1)),
      tags: [video.accountHandle, "instagram"],
      sourceAccount: video.accountHandle,
      createdAt: now
    } : null;
    return { download, asset };
  }));
  const downloads = results.map((item) => item.download);
  const assets = results.map((item) => item.asset).filter(Boolean);

  await mutateStore((next) => {
    next.downloads.unshift(...downloads);
    next.assets.unshift(...assets);
    next.videos = next.videos.map((video) =>
      videoIds.includes(video.id) ? { ...video, status: assets.some((asset) => asset.videoId === video.id) ? "downloaded" : "download_failed" } : video
    );
  });

  res.status(201).json({ downloads, assets });
}));

app.post("/api/uploads", upload.single("media"), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a media file." });
  const ext = path.extname(req.file.originalname) || ".mp4";
  const filename = `${makeId("upload")}${ext}`;
  const target = path.join(dataDir, "uploads", filename);
  await fs.rename(req.file.path, target);
  const now = new Date().toISOString();
  const asset = {
    id: makeId("asset"),
    type: req.file.mimetype.startsWith("audio/") ? "audio" : req.file.mimetype.startsWith("image/") ? "image" : "video",
    filename: req.file.originalname,
    localPath: target,
    previewUrl: req.file.mimetype.startsWith("audio/") ? null : toStorageUrl(target),
    thumbnailUrl: req.file.mimetype.startsWith("image/") ? toStorageUrl(target) : null,
    durationSec: 0,
    resolution: "unknown",
    fileSizeMb: Number((req.file.size / 1024 / 1024).toFixed(2)),
    tags: ["upload"],
    sourceAccount: "local",
    createdAt: now
  };
  await mutateStore((db) => db.assets.unshift(asset));
  res.status(201).json(asset);
}));

app.get("/api/assets", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.assets);
}));

// Clears Library only: downloaded + uploaded media records and their files.
// Does not touch Instagram accounts, editor projects, or the export queue.
app.delete("/api/assets", ah(async (_req, res) => {
  const removed = await mutateStore((db) => {
    const assets = [...(db.assets || [])];
    db.assets = [];
    db.downloads = [];
    return assets;
  });
  for (const asset of removed) {
    if (asset.localPath) await fs.rm(asset.localPath, { force: true }).catch(() => {});
    if (asset.thumbnailUrl?.startsWith("/storage/")) {
      const thumb = path.join(dataDir, asset.thumbnailUrl.replace(/^\/storage\//, ""));
      await fs.rm(thumb, { force: true }).catch(() => {});
    }
  }
  res.json({ ok: true, cleared: removed.length });
}));

app.get("/api/library", ah(async (req, res) => {
  const db = await readStore();
  const query = String(req.query.q || "").toLowerCase();
  const source = String(req.query.source || "");
  const assets = db.assets
    .filter((asset) => !query || asset.filename.toLowerCase().includes(query) || asset.tags.join(" ").toLowerCase().includes(query))
    .filter((asset) => !source || asset.sourceAccount === source)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(assets);
}));

app.patch("/api/library/:id", ah(async (req, res) => {
  const asset = await mutateStore((db) => {
    const index = db.assets.findIndex((item) => item.id === req.params.id);
    if (index === -1) return null;
    db.assets[index] = { ...db.assets[index], ...req.body };
    return db.assets[index];
  });
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  res.json(asset);
}));

app.delete("/api/library/:id", ah(async (req, res) => {
  await mutateStore((db) => {
    db.assets = db.assets.filter((item) => item.id !== req.params.id);
  });
  res.status(204).end();
}));

app.get("/api/templates", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.templates);
}));

const TemplateSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1).default("Custom"),
  accent: z.string().default("#0f8f7e"),
  components: z.array(z.string()).default([])
});

// Template create/edit accepts either JSON or multipart (with an optional file).
// components arrives as an array (JSON) or a comma/JSON string (multipart).
function parseTemplateBody(req) {
  const body = { ...(req.body || {}) };
  if (typeof body.components === "string") {
    try {
      const parsed = JSON.parse(body.components);
      body.components = Array.isArray(parsed) ? parsed : String(body.components).split(",");
    } catch {
      body.components = body.components.split(",");
    }
  }
  if (Array.isArray(body.components)) {
    body.components = body.components.map((item) => String(item).trim()).filter(Boolean);
  }
  return body;
}

async function storeTemplateAsset(file) {
  const ext = path.extname(file.originalname) || "";
  const filename = `${makeId("tplfile")}${ext}`;
  const target = path.join(dataDir, "templates", filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(file.path, target);
  return {
    assetPath: target,
    assetUrl: toStorageUrl(target),
    assetType: file.mimetype?.startsWith("video/") ? "video" : file.mimetype?.startsWith("image/") ? "image" : "file",
    assetName: file.originalname
  };
}

app.post("/api/templates", upload.single("file"), ah(async (req, res) => {
  const input = TemplateSchema.parse(parseTemplateBody(req));
  const template = { id: makeId("tpl"), custom: true, ...input };
  if (req.file) Object.assign(template, await storeTemplateAsset(req.file));
  await mutateStore((db) => db.templates.unshift(template));
  res.status(201).json(template);
}));

app.patch("/api/templates/:id", upload.single("file"), ah(async (req, res) => {
  const patch = TemplateSchema.partial().parse(parseTemplateBody(req));
  const asset = req.file ? await storeTemplateAsset(req.file) : null;
  const template = await mutateStore((db) => {
    const index = db.templates.findIndex((item) => item.id === req.params.id);
    if (index === -1) return null;
    db.templates[index] = { ...db.templates[index], ...patch, ...(asset || {}) };
    return db.templates[index];
  });
  if (!template) return res.status(404).json({ error: "Template not found" });
  res.json(template);
}));

app.delete("/api/templates/:id", ah(async (req, res) => {
  const db = await readStore();
  const target = db.templates.find((item) => item.id === req.params.id);
  if (target?.default) {
    return res.status(400).json({ error: "Default templates can't be deleted." });
  }
  const existed = await mutateStore((store) => {
    const before = store.templates.length;
    store.templates = store.templates.filter((item) => item.id !== req.params.id);
    return before !== store.templates.length;
  });
  if (!existed) return res.status(404).json({ error: "Template not found" });
  res.status(204).end();
}));

app.post("/api/projects", ah(async (req, res) => {
  const schema = z.object({
    videoIds: z.array(z.string()).default([]),
    assetIds: z.array(z.string()).default([]),
    headline: z.string().default("Make it impossible to scroll past"),
    template: z.string().optional()
  }).refine((value) => value.videoIds.length || value.assetIds.length, {
    message: "Select at least one video or library asset"
  });
  const body = schema.parse(req.body);
  const db = await readStore();
  let templateId = body.template;
  if (!templateId || !db.templates.some((item) => item.id === templateId)) {
    templateId = resolveDefaultTemplateId(db);
  }
  const input = { ...body, template: templateId };
  // For a fetched video that was already downloaded, attach the downloaded
  // asset's file + preview URL so the editor can play it and render can use it.
  const videoClips = db.videos
    .filter((video) => input.videoIds.includes(video.id))
    .map((video) => {
      const asset = db.assets.find((item) => item.videoId === video.id && item.localPath);
      return asset
        ? { ...video, localPath: asset.localPath, previewUrl: asset.previewUrl, assetId: asset.id }
        : video;
    });
  const clips = [
    ...videoClips,
    ...db.assets.filter((asset) => input.assetIds.includes(asset.id))
  ];
  const project = {
    id: makeId("proj"),
    name: `Reel remix ${new Date().toLocaleDateString()}`,
    headline: input.headline,
    template: input.template,
    outro: await defaultOutro(),
    clips,
    canvas: { width: 1080, height: 1920, fps: 60 },
    exportSettings: { format: "mp4", codec: "h264", audio: "aac", fps: 60, width: 1080, height: 1920 },
    overlays: [{ id: makeId("txt"), type: "text", text: input.headline, x: 50, y: 12, size: 46 }],
    timeline: [
      { id: makeId("trk"), type: "video", name: "Video", clips: clips.map((clip, index) => ({ clipId: clip.id, start: index * 8, duration: clip.durationSec || 8 })) },
      { id: makeId("trk"), type: "headline", name: "Headline", clips: [{ text: input.headline, start: 0, duration: 8 }] },
      { id: makeId("trk"), type: "audio", name: "Audio", clips: [] }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await mutateStore((next) => {
    next.projects.unshift(project);
    // Proceeding to edit discards the videos that were not selected.
    if (input.videoIds.length) {
      next.videos = next.videos.filter((video) => input.videoIds.includes(video.id));
    }
  });
  res.status(201).json(project);
}));

app.get("/api/projects", ah(async (_req, res) => {
  const db = await readStore();
  const projects = [...db.projects].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
  );
  res.json(projects);
}));

app.get("/api/projects/:id", ah(async (req, res) => {
  const db = await readStore();
  const project = db.projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
}));

app.patch("/api/projects/:id", ah(async (req, res) => {
  const project = await mutateStore((db) => {
    const index = db.projects.findIndex((item) => item.id === req.params.id);
    if (index === -1) return null;
    db.projects[index] = { ...db.projects[index], ...req.body, updatedAt: new Date().toISOString() };
    return db.projects[index];
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
}));

// Removes one editor project so Prev/Next reel state is cleared for that edit.
app.delete("/api/projects/:id", ah(async (req, res) => {
  const existed = await mutateStore((db) => {
    const before = db.projects.length;
    db.projects = db.projects.filter((item) => item.id !== req.params.id);
    return before !== db.projects.length;
  });
  if (!existed) return res.status(404).json({ error: "Project not found" });
  res.status(204).end();
}));

app.post("/api/projects/:id/render", ah(async (req, res) => {
  const db = await readStore();
  const project = db.projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  // Optional body overrides let the editor export a single clip with its own
  // trim/outro/skip settings (edit and export selected reels one by one).
  const body = req.body || {};
  const selectedClip = body.clipId
    ? project.clips.find((clip) => clip.id === body.clipId || clip.clipId === body.clipId)
    : null;
  const template = db.templates.find((item) => item.id === project.template);
  // Box-mode: an opaque template image with a defined content box composites the
  // video INTO the box (template behind). Plain image templates without a box keep
  // the legacy behavior (baked into the client overlay PNG on top of the video).
  const useBoxTemplate = template?.assetType === "image" && template?.contentBox;
  const templatePath = useBoxTemplate ? template.localPath || null : null;
  const contentBox = useBoxTemplate ? template.contentBox : null;
  const renderSpec = {
    ...project,
    clips: selectedClip ? [selectedClip] : project.clips,
    headline: body.headline ?? project.headline,
    trimStart: body.trimStart ?? project.trimStart ?? 0,
    trimEnd: body.trimEnd ?? project.trimEnd ?? null,
    skipOriginal: body.skipOriginal ?? project.skipOriginal ?? false,
    zoom: body.zoom ?? project.zoom ?? 1,
    panX: body.panX ?? project.panX ?? 0,
    panY: body.panY ?? project.panY ?? 0,
    overlayImage: body.overlayImage ?? null,
    templatePath,
    contentBox,
    outro: body.outro ?? project.outro ?? null
  };

  const job = { id: makeId("job"), projectId: project.id, status: "queued", progress: 0, createdAt: new Date().toISOString() };
  // Each export gets its own output file (keyed by job id) so exporting reel 1
  // then reel 2 produces two distinct videos instead of overwriting each other.
  renderSpec.renderId = job.id;
  if (selectedClip) job.clipTitle = selectedClip.title || selectedClip.filename || null;
  res.status(202).json(job);

  await mutateStore((next) => next.renderJobs.unshift(job));
  try {
    const result = await renderProject(renderSpec);
    result.outputUrl = toStorageUrl(result.outputPath);
    await mutateStore((next) => {
      const saved = next.renderJobs.find((item) => item.id === job.id);
      if (saved) Object.assign(saved, { status: "complete", result, completedAt: new Date().toISOString() });
    });
    // Note: the downloaded source is intentionally NOT deleted right after
    // export, so the reel stays editable/re-exportable. The retention sweep
    // (RETENTION_HOURS) removes downloads, uploads, and projects on schedule.
  } catch (error) {
    logger.error(error);
    await mutateStore((next) => {
      const saved = next.renderJobs.find((item) => item.id === job.id);
      if (saved) Object.assign(saved, { status: "failed", error: error.message });
    });
  }
}));

app.get("/api/render-jobs", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.renderJobs);
}));

app.get("/api/export", ah(async (_req, res) => {
  const db = await readStore();
  res.json(db.renderJobs);
}));

app.patch("/api/render-jobs/:id", ah(async (req, res) => {
  const schema = z.object({ action: z.enum(["cancel"]) });
  const { action } = schema.parse(req.body);
  const job = await mutateStore((db) => {
    const found = db.renderJobs.find((item) => item.id === req.params.id);
    if (!found) return null;
    found.status = action === "cancel" ? "cancelled" : found.status;
    return found;
  });
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
}));

// Removes a finished/failed job from the queue and deletes its rendered file.
app.delete("/api/render-jobs/:id", ah(async (req, res) => {
  const removed = await mutateStore((db) => {
    const found = db.renderJobs.find((item) => item.id === req.params.id);
    if (!found) return null;
    db.renderJobs = db.renderJobs.filter((item) => item.id !== req.params.id);
    return found;
  });
  if (!removed) return res.status(404).json({ error: "Job not found" });
  if (removed.result?.outputPath) await fs.rm(removed.result.outputPath, { force: true }).catch(() => {});
  res.status(204).end();
}));

// Centralized error handling: turn validation errors into 400s and any other
// error into a 500 without ever crashing the server process.
app.use((err, _req, res, _next) => {
  if (err?.name === "ZodError") {
    return res.status(400).json({ error: "Validation failed", issues: err.issues });
  }
  logger.error(err);
  res.status(500).json({ error: err?.message || "Internal server error" });
});

process.on("unhandledRejection", (reason) => logger.error({ reason }, "Unhandled promise rejection"));
process.on("uncaughtException", (error) => logger.error(error, "Uncaught exception"));

await ensureStore();
await ensureDefaultTemplates(mutateStore).catch((error) => logger.error(error, "Failed to seed default templates"));

// Auto-remove fetched/downloaded/exported media and stale projects past the
// retention window (default 6h). Runs on boot and every 10 minutes after.
await purgeExpired(RETENTION_HOURS, logger).catch((error) => logger.error(error, "Initial retention sweep failed"));
setInterval(() => {
  purgeExpired(RETENTION_HOURS, logger).catch((error) => logger.error(error, "Retention sweep failed"));
}, 10 * 60 * 1000).unref();

app.listen(port, host, () => logger.info(`SmartForgeReel API running on http://${host}:${port} (retention: ${RETENTION_HOURS}h)`));

function toStorageUrl(filePath) {
  if (!filePath) return null;
  const relative = path.relative(dataDir, filePath).split(path.sep).join("/");
  return relative.startsWith("..") ? null : `/storage/${relative}`;
}

