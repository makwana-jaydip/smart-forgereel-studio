import path from "node:path";
import fs from "node:fs/promises";
import { root } from "./store.js";

// Optional brand assets live here (gitignored). The app runs without them using
// the Clean template and no default outro until files are added locally.
export const defaultsDir = path.join(root, "server", "assets", "defaults");
export const DEFAULT_TEMPLATE_PATH = path.join(defaultsDir, "template.png");
export const CLASSIC_TEMPLATE_PATH = path.join(defaultsDir, "template-classic.png");
export const DEFAULT_OUTRO_PATH = path.join(defaultsDir, "outro.mp4");
export const DEFAULT_TEMPLATE_ID = "tpl_default";
export const CLASSIC_TEMPLATE_ID = "tpl_default_classic";
export const CLEAN_TEMPLATE_ID = "tpl_clean";

// Video content area inside the white frame (1080×1920), measured from pixels.
// Update these if your template.png / template-classic.png inner box differs.
export const DEFAULT_CONTENT_BOX = { x: 41, y: 620, w: 1002, h: 1169 };
export const CLASSIC_CONTENT_BOX = { x: 34, y: 619, w: 1006, h: 1170 };

export function defaultTemplateRecord() {
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: "Default frame",
    category: "Frame",
    accent: "#0b2a4a",
    default: true,
    custom: false,
    components: ["logo", "headline", "video frame", "social bar"],
    assetType: "image",
    assetUrl: "/defaults/template.png",
    assetName: "template.png",
    localPath: DEFAULT_TEMPLATE_PATH,
    contentBox: DEFAULT_CONTENT_BOX
  };
}

export function classicTemplateRecord() {
  return {
    id: CLASSIC_TEMPLATE_ID,
    name: "Default frame (classic)",
    category: "Frame",
    accent: "#0b2a4a",
    default: true,
    custom: false,
    components: ["logo", "headline", "video frame", "social bar"],
    assetType: "image",
    assetUrl: "/defaults/template-classic.png",
    assetName: "template-classic.png",
    localPath: CLASSIC_TEMPLATE_PATH,
    contentBox: CLASSIC_CONTENT_BOX
  };
}

export function cleanTemplateRecord() {
  return {
    id: CLEAN_TEMPLATE_ID,
    name: "Clean (full frame)",
    category: "Basic",
    accent: "#111827",
    default: true,
    custom: false,
    components: ["video"],
    assetType: "none"
  };
}

export async function defaultOutro() {
  if (await fileExists(DEFAULT_OUTRO_PATH)) {
    return {
      enabled: true,
      localPath: DEFAULT_OUTRO_PATH,
      previewUrl: "/defaults/outro.mp4",
      name: "outro.mp4",
      durationSec: 5
    };
  }
  return { enabled: false, durationSec: 2 };
}

/** Which template new projects should use when none is specified. */
export function resolveDefaultTemplateId(db) {
  const ids = (db?.templates || []).map((t) => t.id);
  if (ids.includes(DEFAULT_TEMPLATE_ID)) return DEFAULT_TEMPLATE_ID;
  if (ids.includes(CLASSIC_TEMPLATE_ID)) return CLASSIC_TEMPLATE_ID;
  return CLEAN_TEMPLATE_ID;
}

export async function getDefaultsStatus(db) {
  return {
    defaultTemplateId: resolveDefaultTemplateId(db)
  };
}

export async function ensureDefaultsDirectory() {
  await fs.mkdir(defaultsDir, { recursive: true });
}

// Seeds file-based templates when present; always keeps Clean. Drops DB entries
// for branded defaults whose files were removed so clones without assets stay clean.
export async function ensureDefaultTemplates(mutateStore) {
  await ensureDefaultsDirectory();
  const hasTemplate = await fileExists(DEFAULT_TEMPLATE_PATH);
  const hasClassic = await fileExists(CLASSIC_TEMPLATE_PATH);

  const records = [];
  if (hasTemplate) records.push(defaultTemplateRecord());
  if (hasClassic) records.push(classicTemplateRecord());
  records.push(cleanTemplateRecord());

  return mutateStore((db) => {
    db.templates = (db.templates || []).filter(
      (item) =>
        item.id !== DEFAULT_TEMPLATE_ID &&
        item.id !== CLASSIC_TEMPLATE_ID &&
        item.id !== CLEAN_TEMPLATE_ID
    );
    for (const record of records) {
      db.templates.push(record);
    }
    const order = { [DEFAULT_TEMPLATE_ID]: 0, [CLASSIC_TEMPLATE_ID]: 1, [CLEAN_TEMPLATE_ID]: 2 };
    db.templates.sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));
    return db.templates;
  });
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
