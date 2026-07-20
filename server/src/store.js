import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

const root = process.cwd().includes("/server")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const dataDir = path.join(root, "storage");
const dbPath = path.join(dataDir, "db.json");
const sqlitePath = path.join(dataDir, "smartforgereel.sqlite");

const seed = {
  users: [],
  settings: [],
  accounts: [],
  videos: [],
  downloads: [],
  assets: [],
  // Built-in templates are seeded on startup via ensureDefaultTemplates().
  templates: [],
  brandAssets: [],
  projects: [],
  renderJobs: []
};

const collectionKeys = [
  "users",
  "settings",
  "accounts",
  "videos",
  "downloads",
  "assets",
  "templates",
  "brandAssets",
  "projects",
  "renderJobs"
];

function freshSeed() {
  return structuredClone(seed);
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    const key = item?.id ?? makeId("row");
    map.set(key, item);
  }
  return [...map.values()];
}

export async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  await Promise.all(["downloads", "exports", "renders", "uploads", "thumbnails", "projects", "templates", "fonts", "cache", "temp", "autosave"].map((dir) => fs.mkdir(path.join(dataDir, dir), { recursive: true })));
  ensureSqlite();
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify(freshSeed(), null, 2));
  }
}

export async function readStore() {
  await ensureStore();
  const sqlite = readSqlite();
  if (hasSqliteData(sqlite)) return normalizeStore(sqlite);

  const raw = await fs.readFile(dbPath, "utf8");
  const db = normalizeStore(JSON.parse(raw));
  writeSqlite(db);
  await writeStore(db);
  return db;
}

export async function writeStore(next) {
  const db = normalizeStore(next);
  writeSqlite(db);
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

export async function mutateStore(mutator) {
  const db = await readStore();
  const result = await mutator(db);
  await writeStore(db);
  return result;
}

export function makeId(prefix) {
  return `${prefix}_${nanoid(10)}`;
}

function normalizeStore(db) {
  const base = freshSeed();
  return {
    ...base,
    ...db,
    templates: db.templates?.length ? db.templates : base.templates,
    users: db.users || [],
    settings: db.settings || [],
    accounts: db.accounts || [],
    videos: db.videos || [],
    downloads: db.downloads || [],
    assets: db.assets || [],
    brandAssets: db.brandAssets || [],
    projects: db.projects || [],
    renderJobs: db.renderJobs || []
  };
}

function ensureSqlite() {
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
  db.close();
}

function readSqlite() {
  const db = new Database(sqlitePath);
  const rows = db.prepare("SELECT collection, data FROM kv_store").all();
  db.close();
  const next = {};
  for (const key of collectionKeys) next[key] = [];
  for (const row of rows) {
    next[row.collection] ||= [];
    next[row.collection].push(JSON.parse(row.data));
  }
  return next;
}

function writeSqlite(store) {
  const db = new Database(sqlitePath);
  const transaction = db.transaction(() => {
    for (const collection of collectionKeys) {
      db.prepare("DELETE FROM kv_store WHERE collection = ?").run(collection);
      const insert = db.prepare("INSERT OR REPLACE INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
      for (const item of dedupeById(store[collection] || [])) {
        insert.run(collection, item.id || makeId(collection), JSON.stringify(item), new Date().toISOString());
      }
    }
  });
  transaction();
  db.close();
}

function hasSqliteData(db) {
  return ["users", "accounts", "videos", "downloads", "assets", "projects", "renderJobs"].some((key) => db[key]?.length) || db.templates?.length;
}

export { dataDir, root };
