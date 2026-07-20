import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Stage, Layer, Group, Rect, Image as KonvaImage, Text } from "react-konva";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  User,
  Wand2
} from "lucide-react";
import "./styles/app.css";

const apiBase = import.meta.env.VITE_API_BASE || "http://127.0.0.1:4000";
const CLEAN_TEMPLATE_ID = "tpl_clean";
const DEFAULT_TEXT_SIZE = 28;
const DEFAULT_FONT = "Arial, sans-serif";
const DEFAULT_WEIGHT = 700;

// Curated font list. System fonts render everywhere; the rest are loaded from
// Google Fonts (see index.html) so the preview and exported PNG look identical.
const FONT_OPTIONS = [
  { label: "Arial", css: "Arial, sans-serif" },
  { label: "Helvetica", css: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", css: "Verdana, sans-serif" },
  { label: "Trebuchet MS", css: "'Trebuchet MS', sans-serif" },
  { label: "Impact", css: "Impact, Haettenschweiler, sans-serif" },
  { label: "Georgia", css: "Georgia, serif" },
  { label: "Times New Roman", css: "'Times New Roman', serif" },
  { label: "Courier New", css: "'Courier New', monospace" },
  { label: "Roboto", css: "'Roboto', sans-serif" },
  { label: "Open Sans", css: "'Open Sans', sans-serif" },
  { label: "Montserrat", css: "'Montserrat', sans-serif" },
  { label: "Poppins", css: "'Poppins', sans-serif" },
  { label: "Lato", css: "'Lato', sans-serif" },
  { label: "Raleway", css: "'Raleway', sans-serif" },
  { label: "Noto Sans", css: "'Noto Sans', sans-serif" },
  { label: "Oswald", css: "'Oswald', sans-serif" },
  { label: "Bebas Neue", css: "'Bebas Neue', sans-serif" },
  { label: "Anton", css: "'Anton', sans-serif" },
  { label: "Playfair Display", css: "'Playfair Display', serif" },
  { label: "Merriweather", css: "'Merriweather', serif" }
];

const WEIGHT_OPTIONS = [
  { label: "Light", value: 300 },
  { label: "Normal", value: 400 },
  { label: "Bold", value: 700 }
];

// Konva fontStyle string, e.g. "italic 700" / "400" (weight + optional italic).
function fontStyleString(weight, italic) {
  const w = Number(weight) || DEFAULT_WEIGHT;
  return `${italic ? "italic " : ""}${w}`;
}

// Full CSS font shorthand for canvas text measurement (must match rendering).
function measureFont(style, size) {
  return `${style.italic ? "italic " : ""}${Number(style.weight) || DEFAULT_WEIGHT} ${size}px ${style.font || DEFAULT_FONT}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return null;
  return response.json();
}

function mediaUrl(src) {
  if (!src) return "";
  return src.startsWith("/storage") || src.startsWith("/defaults") ? `${apiBase}${src}` : src;
}

// The browser ignores the <a download> attribute for cross-origin URLs (the API
// runs on a different port), so fetch the file as a blob and save it directly.
async function downloadFile(src, filename) {
  const response = await fetch(mediaUrl(src));
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || "smartforgereel-export.mp4";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

const navItems = [
  ["dashboard", BarChart3, "Dashboard"],
  ["instagram", Clapperboard, "Instagram"],
  ["library", FolderOpen, "Library"],
  ["templates", Sparkles, "Templates"],
  ["editor", Film, "Editor"],
  ["exports", Download, "Export Queue"],
  ["settings", Settings, "Settings"]
];

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/*" element={<StudioShell />} />
      </Routes>
    </BrowserRouter>
  );
}

function StudioShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const page = location.pathname.replace(/^\//, "") || "dashboard";
  const setPage = (next) => navigate(`/${next}`);
  const [dashboard, setDashboard] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [videos, setVideos] = useState([]);
  const [assets, setAssets] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [config, setConfig] = useState({ retentionHours: 6, defaultTemplateId: CLEAN_TEMPLATE_ID });
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef(null);

  async function refresh() {
    const [dash, accts, vids, lib, tpl, exportJobs, localUsers, projectList, cfg] = await Promise.all([
      api("/api/dashboard"),
      api("/api/accounts"),
      api("/api/videos"),
      api("/api/library"),
      api("/api/templates"),
      api("/api/render-jobs"),
      api("/api/users"),
      api("/api/projects"),
      api("/api/config")
    ]);
    setDashboard(dash);
    setAccounts(accts);
    setVideos(vids);
    setAssets(lib);
    setTemplates(tpl);
    setJobs(exportJobs);
    setUsers(localUsers);
    setProjects(projectList);
    if (cfg) setConfig(cfg);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addAccount(payload) {
    await api("/api/accounts", { method: "POST", body: JSON.stringify(payload) });
    await refresh();
  }

  async function updateAccount(id, payload) {
    await api(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    await refresh();
  }

  async function deleteAccount(id) {
    await api(`/api/accounts/${id}`, { method: "DELETE" });
    setSelectedVideos([]);
    await refresh();
  }

  async function clearAccounts() {
    await api("/api/accounts", { method: "DELETE" });
    setSelectedVideos([]);
    await refresh();
  }

  async function clearVideos() {
    await api("/api/videos", { method: "DELETE" });
    setSelectedVideos([]);
    await refresh();
  }

  async function discover() {
    setBusy(true);
    try {
      const result = await api("/api/discover", { method: "POST", body: JSON.stringify({}) });
      const found = Array.isArray(result) ? result : result?.videos || [];
      const errors = Array.isArray(result) ? [] : result?.errors || [];
      setVideos(found);
      setPage("instagram");
      if (errors.length) {
        const detail = errors.map((item) => `@${item.handle}: ${item.message}`).join("\n");
        if (found.length) window.alert(`Fetched ${found.length} videos. Some accounts could not be fetched:\n\n${detail}`);
        else window.alert(`No videos fetched.\n\n${detail}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function downloadSelected() {
    setBusy(true);
    try {
      await api("/api/downloads", { method: "POST", body: JSON.stringify({ videoIds: selectedVideos }) });
      setSelectedVideos([]);
      await refresh();
      setPage("library");
    } finally {
      setBusy(false);
    }
  }

  async function createProject({ from = "videos", template = config.defaultTemplateId || CLEAN_TEMPLATE_ID } = {}) {
    const videoIds = from === "videos" ? selectedVideos : [];
    const assetIds = from === "assets" ? selectedAssets : [];

    if (!videoIds.length && !assetIds.length) {
      if (project) {
        await updateProject({ ...project, template });
        setPage("editor");
        return;
      }
      window.alert("Select at least one video (Instagram tab) or library asset first, then pick a template.");
      setPage(selectedAssets.length ? "library" : "instagram");
      return;
    }

    const payload = {
      videoIds,
      assetIds,
      headline: "Make it impossible to scroll past",
      template
    };
    const created = await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
    setProject(created);
    setPage("editor");
    await refresh();
  }

  // Optimistic + debounced: update local state immediately so typing/dragging
  // stays smooth, and persist ~400ms after the last edit. We intentionally do
  // NOT re-set state from the response, which previously caused rapid edits to
  // revert (out-of-order PATCH responses dropping characters).
  function updateProject(next) {
    setProject(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api(`/api/projects/${next.id}`, { method: "PATCH", body: JSON.stringify(next) }).catch(() => {});
    }, 400);
  }

  async function renderProject(spec = {}) {
    if (!project) return;
    // Flush any pending debounced autosave so the render reads the latest project.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(project) }).catch(() => {});
    }
    const job = await api(`/api/projects/${project.id}/render`, {
      method: "POST",
      body: JSON.stringify(spec)
    });
    setJobs((items) => [job, ...items]);
    setPage("exports");
    setTimeout(refresh, 1600);
  }

  function templateRequest(payload, file) {
    if (!file) {
      return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
    }
    const body = new FormData();
    body.append("name", payload.name);
    body.append("category", payload.category);
    body.append("accent", payload.accent);
    body.append("components", JSON.stringify(payload.components || []));
    body.append("file", file);
    // No Content-Type header: the browser sets the multipart boundary itself.
    return { headers: {}, body };
  }

  async function createTemplate(payload, file) {
    const options = templateRequest(payload, file);
    await fetch(`${apiBase}/api/templates`, { method: "POST", ...options }).then((res) => {
      if (!res.ok) throw new Error("Failed to create template");
    });
    await refresh();
  }

  async function updateTemplate(id, payload, file) {
    const options = templateRequest(payload, file);
    await fetch(`${apiBase}/api/templates/${id}`, { method: "PATCH", ...options }).then((res) => {
      if (!res.ok) throw new Error("Failed to update template");
    });
    await refresh();
  }

  async function uploadOutro(file) {
    const body = new FormData();
    body.append("media", file);
    const res = await fetch(`${apiBase}/api/uploads`, { method: "POST", body });
    const asset = await res.json();
    await refresh();
    return asset;
  }

  function resumeProject(next) {
    setProject(next);
    setPage("editor");
  }

  async function deleteTemplate(id) {
    await api(`/api/templates/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function deleteJob(jobId) {
    await api(`/api/render-jobs/${jobId}`, { method: "DELETE" });
    await refresh();
  }

  // Library only: remove downloaded/uploaded media from the Library (not projects
  // or the export queue).
  async function clearLibrary() {
    const ok = window.confirm(
      "Clear Library?\n\nThis removes all downloaded reels and uploaded media from the Library.\n\nEditor projects and the Export Queue are left alone."
    );
    if (!ok) return;
    await api("/api/assets", { method: "DELETE" });
    setSelectedAssets([]);
    await refresh();
  }

  // Editor only: drop the current project so Prev/Next reel and edits are cleared.
  async function clearEditorProject(projectId) {
    if (!projectId) return;
    const ok = window.confirm(
      "Clear this edit?\n\nThis removes the current project from the Editor (Prev/Next reels and your edits for this project).\n\nLibrary media and Export Queue downloads are left alone."
    );
    if (!ok) return;
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    setProject(null);
    await refresh();
  }

  async function addUser(payload) {
    await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
    await refresh();
  }

  async function uploadMedia(file) {
    const body = new FormData();
    body.append("media", file);
    await fetch(`${apiBase}/api/uploads`, { method: "POST", body });
    await refresh();
  }

  async function uploadInstagramCookies(file) {
    const body = new FormData();
    body.append("cookies", file);
    await fetch(`${apiBase}/api/auth/instagram-session`, { method: "POST", body });
  }

  return (
    <main>
      <aside>
        <div className="brand">
          <Clapperboard size={30} />
          <div>
            <strong>SmartForgeReel</strong>
            <span>Local-first web studio</span>
          </div>
        </div>
        <nav>
          {navItems.map(([id, Icon, label]) => (
            <NavLink key={id} className={page === id ? "active" : ""} to={`/${id}`}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="status">
          <span>{accounts.length} Instagram accounts</span>
          <span>{assets.length} library assets</span>
          <span>{jobs[0]?.status ? `Latest export: ${jobs[0].status}` : "No exports yet"}</span>
        </div>
      </aside>

      <section className="workspace">
        {page === "dashboard" && (
          <Dashboard
            data={dashboard}
            onNavigate={setPage}
            projects={projects}
            onResume={resumeProject}
            retentionHours={config.retentionHours}
          />
        )}
        {page === "instagram" && (
          <Instagram
            accounts={accounts}
            videos={videos}
            selected={selectedVideos}
            setSelected={setSelectedVideos}
            onAdd={addAccount}
            onEdit={updateAccount}
            onDelete={deleteAccount}
            onClearAccounts={clearAccounts}
            onClearVideos={clearVideos}
            onDiscover={discover}
            onDownload={downloadSelected}
            onProject={() => createProject({ from: "videos" })}
            retentionHours={config.retentionHours}
            busy={busy}
          />
        )}
        {page === "library" && (
          <Library
            assets={assets}
            selected={selectedAssets}
            setSelected={setSelectedAssets}
            onProject={() => createProject({ from: "assets" })}
            onRefresh={refresh}
            onUpload={uploadMedia}
            onClearLibrary={clearLibrary}
            retentionHours={config.retentionHours}
          />
        )}
        {page === "templates" && (
          <Templates
            templates={templates}
            onUse={(template) => createProject({ from: selectedAssets.length ? "assets" : "videos", template: template.id })}
            onCreate={createTemplate}
            onUpdate={updateTemplate}
            onDelete={deleteTemplate}
          />
        )}
        {page === "editor" && (
          <Editor
            project={project}
            projects={projects}
            templates={templates}
            assets={assets}
            onChange={updateProject}
            onRender={renderProject}
            onUploadOutro={uploadOutro}
            onResume={resumeProject}
            onClearProject={clearEditorProject}
            retentionHours={config.retentionHours}
          />
        )}
        {page === "exports" && <ExportQueue jobs={jobs} onRefresh={refresh} onDeleteJob={deleteJob} retentionHours={config.retentionHours} />}
        {page === "settings" && <SettingsPage users={users} onAddUser={addUser} onCookieUpload={uploadInstagramCookies} />}
        {!navItems.some(([id]) => id === page) && <Navigate to="/dashboard" replace />}
      </section>
    </main>
  );
}

function RetentionNotice({ hours = 6, children }) {
  return (
    <p className="retention-notice">
      <RefreshCcw size={14} />
      {children || `Everything is temporary: fetched reels, downloaded clips, uploads, and exports auto-delete ${hours} hours after they are added, so storage never piles up. A project you are editing is kept for ${hours} hours after your last change so you can resume, then removed.`}
    </p>
  );
}

function Dashboard({ data, onNavigate, projects = [], onResume, retentionHours }) {
  const totals = data?.totals || { projects: 0, downloadedVideos: 0, exportQueue: 0, templates: 0 };
  const resumable = projects.slice(0, 5);
  return (
    <div className="panel">
      <header>
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Build, manage, and export vertical videos from one local web workspace.</h1>
        </div>
        <button className="primary" onClick={() => onNavigate("instagram")}><Plus size={18} /> Add source</button>
      </header>
      <RetentionNotice hours={retentionHours} />
      <div className="metric-grid">
        <Metric label="Total Projects" value={totals.projects} />
        <Metric label="Downloaded Videos" value={totals.downloadedVideos} />
        <Metric label="Export Queue" value={totals.exportQueue} />
        <Metric label="Templates" value={totals.templates} />
      </div>
      {resumable.length > 0 && (
        <section className="surface">
          <h2>Continue where you left off</h2>
          <div className="resume-list">
            {resumable.map((item) => (
              <button key={item.id} className="resume-item" onClick={() => onResume(item)}>
                <strong>{item.name}</strong>
                <span>{(item.clips || []).length} reel(s) · edited {new Date(item.updatedAt || item.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="two-col">
        <Activity title="Recent Projects" items={data?.recentProjects || []} empty="No projects yet" />
        <Activity title="Export Progress" items={data?.exportProgress || []} empty="No export jobs yet" />
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Activity({ title, items, empty }) {
  return (
    <section className="surface">
      <h2>{title}</h2>
      <div className="activity-list">
        {items.length ? items.map((item) => (
          <span key={item.id}>{item.name || item.filename || `${item.projectId} · ${item.status}`}</span>
        )) : <span>{empty}</span>}
      </div>
    </section>
  );
}

function Instagram({ accounts, videos, selected, setSelected, onAdd, onEdit, onDelete, onClearAccounts, onClearVideos, onDiscover, onDownload, onProject, retentionHours, busy }) {
  const [handle, setHandle] = useState("");
  const [urls, setUrls] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editHandle, setEditHandle] = useState("");
  const [editUrls, setEditUrls] = useState("");

  async function submit(event) {
    event.preventDefault();
    const urlList = urls.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!handle.trim() && !urlList.length) {
      window.alert("Enter an account handle or paste at least one reel URL.");
      return;
    }
    await onAdd({ handle: handle.trim(), mode: urlList.length ? "urls" : "live", urls: urlList });
    setHandle("");
    setUrls("");
  }

  function startEdit(account) {
    setEditingId(account.id);
    setEditHandle(account.handle);
    setEditUrls((account.urls || []).join("\n"));
  }

  async function saveEdit(account) {
    const urlList = editUrls.split("\n").map((line) => line.trim()).filter(Boolean);
    await onEdit(account.id, {
      handle: editHandle.trim(),
      mode: urlList.length ? "urls" : account.mode === "urls" ? "live" : account.mode,
      urls: urlList
    });
    setEditingId(null);
  }

  function toggle(id) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  return (
    <div className="panel">
      <header>
        <div>
          <p className="eyebrow">Instagram module</p>
          <h1>Fetch latest public reels and choose what enters your editing pipeline.</h1>
        </div>
        <div className="actions">
          <button onClick={onDiscover} disabled={!accounts.length || busy}><RefreshCcw size={18} /> Fetch latest</button>
          <button className="primary" onClick={onDownload} disabled={!selected.length || busy}><Download size={18} /> Download {selected.length || ""}</button>
        </div>
      </header>
      <RetentionNotice hours={retentionHours}>
        Fetched reels are working data only — select the ones you want, then download or send them to the editor. Everything fetched here auto-deletes after {retentionHours} hours.
      </RetentionNotice>
      <form className="account-form" onSubmit={submit}>
        <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@handle (optional if you paste reel URLs)" />
        <textarea value={urls} onChange={(event) => setUrls(event.target.value)} placeholder="Optional reel URLs, one per line" />
        <button type="submit"><Plus size={18} /> Add account</button>
      </form>
      {accounts.length > 0 && (
        <div className="account-toolbar">
          <span>{accounts.length} source {accounts.length === 1 ? "account" : "accounts"}</span>
          <div className="actions">
            <button onClick={onClearVideos}><RefreshCcw size={16} /> Clear fetched videos</button>
            <button className="danger" onClick={onClearAccounts}><Trash2 size={16} /> Clear all handles</button>
          </div>
        </div>
      )}
      <div className="account-grid">
        {accounts.map((account) => (
          <article key={account.id} className="account">
            {editingId === account.id ? (
              <div className="account-edit">
                <input value={editHandle} onChange={(event) => setEditHandle(event.target.value)} placeholder="@handle" />
                <textarea value={editUrls} onChange={(event) => setEditUrls(event.target.value)} placeholder="Reel URLs, one per line" />
                <div className="actions">
                  <button className="primary" onClick={() => saveEdit(account)}><Check size={16} /> Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <strong>@{account.handle}</strong>
                <span>{account.mode === "urls" ? `${account.urls.length} manual URLs` : account.mode === "mock" ? "mock discovery adapter" : "live reel scraping"}</span>
                <div className="actions">
                  <button onClick={() => startEdit(account)}><Wand2 size={16} /> Edit</button>
                  <button className="danger" onClick={() => onDelete(account.id)}><Trash2 size={16} /> Delete</button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      <VideoGrid videos={videos} selected={selected} onToggle={toggle} />
      <div className="footer-actions">
        <button onClick={onProject} disabled={!selected.length}>Edit selected <ArrowRight size={18} /></button>
      </div>
    </div>
  );
}

function VideoGrid({ videos, selected, onToggle }) {
  return (
    <div className="video-grid">
      {videos.map((video) => (
        <article className={`video ${selected.includes(video.id) ? "selected" : ""}`} key={video.id} onClick={() => onToggle(video.id)}>
          <img src={mediaUrl(video.thumbnailUrl)} alt="" />
          <button aria-label="Select clip">{selected.includes(video.id) ? <Check size={18} /> : <Plus size={18} />}</button>
          <div>
            <strong>{video.title || video.filename}</strong>
            <span>@{video.accountHandle || video.sourceAccount} · {new Date(video.createdAt).toLocaleDateString()} · {(video.views || 0).toLocaleString()} views</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function Library({ assets, selected, setSelected, onProject, onRefresh, onUpload, onClearLibrary, retentionHours }) {
  const [query, setQuery] = useState("");
  const filtered = assets.filter((asset) => asset.filename.toLowerCase().includes(query.toLowerCase()) || asset.tags.join(" ").toLowerCase().includes(query.toLowerCase()));

  function toggle(id) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  return (
    <div className="panel">
      <header>
        <div>
          <p className="eyebrow">Working media</p>
          <h1>The clips you can drop into the editor: downloaded reels plus your own uploads.</h1>
        </div>
        <div className="actions">
          <label className="file-button">
            <Plus size={18} /> Upload media
            <input type="file" accept="video/*,image/*,audio/*" onChange={(event) => event.target.files[0] && onUpload(event.target.files[0])} />
          </label>
          <button onClick={onRefresh}><RefreshCcw size={18} /> Refresh</button>
          <button type="button" className="danger" disabled={!assets.length} onClick={onClearLibrary} title="Remove all Library media">
            <Trash2 size={16} /> Clear library
          </button>
          <button className="primary" disabled={!selected.length} onClick={onProject}><Film size={18} /> Create project</button>
        </div>
      </header>
      <RetentionNotice hours={retentionHours}>
        This is a temporary staging area, not permanent storage. Both downloaded reels and your own uploads auto-delete {retentionHours} hours after they are added, keeping the product lightweight.
      </RetentionNotice>
      <div className="searchbar">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filename, tag, or account" />
      </div>
      <div className="asset-grid">
        {filtered.map((asset) => (
          <article key={asset.id} className={`asset ${selected.includes(asset.id) ? "selected" : ""}`} onClick={() => toggle(asset.id)}>
            <img src={mediaUrl(asset.thumbnailUrl) || "https://picsum.photos/seed/local-upload/640/960"} alt="" />
            <strong>{asset.filename}</strong>
            <span>{asset.durationSec}s · {asset.resolution} · {asset.fileSizeMb} MB</span>
            <span>{asset.tags.join(", ")}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function Templates({ templates, onUse, onCreate, onUpdate, onDelete }) {
  const empty = { name: "", category: "Custom", accent: "#0f8f7e", components: "" };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [file, setFile] = useState(null);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      window.alert("Give the template a name.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || "Custom",
      accent: form.accent,
      components: form.components.split(",").map((item) => item.trim()).filter(Boolean)
    };
    if (editingId) await onUpdate(editingId, payload, file);
    else await onCreate(payload, file);
    setForm(empty);
    setEditingId(null);
    setFile(null);
  }

  function startEdit(template) {
    setEditingId(template.id);
    setFile(null);
    setForm({
      name: template.name,
      category: template.category,
      accent: template.accent || "#0f8f7e",
      components: (template.components || []).join(", ")
    });
  }

  return (
    <div className="panel">
      <header>
        <div>
          <p className="eyebrow">Template system</p>
          <h1>Create, edit, and reuse vertical layouts for any channel or brand.</h1>
        </div>
      </header>

      <form className="template-form" onSubmit={submit}>
        <input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Template name" />
        <input value={form.category} onChange={(event) => set("category", event.target.value)} placeholder="Category" />
        <input type="color" value={form.accent} onChange={(event) => set("accent", event.target.value)} title="Accent color" />
        <input value={form.components} onChange={(event) => set("components", event.target.value)} placeholder="Components, comma separated" />
        <label className="file-button">
          <Plus size={16} /> {file ? file.name.slice(0, 22) : "Upload template file (image/video)"}
          <input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files[0] || null)} />
        </label>
        <div className="actions">
          <button type="submit" className="primary">{editingId ? <><Check size={16} /> Save</> : <><Plus size={16} /> Add template</>}</button>
          {editingId && <button type="button" onClick={() => { setForm(empty); setEditingId(null); setFile(null); }}>Cancel</button>}
        </div>
      </form>

      <div className="template-grid">
        {templates.map((template) => (
          <article key={template.id} className="template">
            <div className="template-preview" style={{ borderColor: template.accent }}>
              {template.assetUrl && template.assetType === "image" ? (
                <img src={mediaUrl(template.assetUrl)} alt="" />
              ) : (
                <span style={{ background: template.accent }} />
              )}
              <strong>{template.category}</strong>
            </div>
            <h2>{template.name}</h2>
            <p>{(template.components || []).join(" · ")}</p>
            {template.assetName && <p className="template-file">File: {template.assetName}</p>}
            <div className="actions">
              <button onClick={() => onUse(template)}><Wand2 size={18} /> Use</button>
              <button onClick={() => startEdit(template)}>Edit</button>
              {template.default ? (
                <span className="badge-default">Default</span>
              ) : (
                <button className="danger" onClick={() => onDelete(template.id)}><Trash2 size={16} /> Delete</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function newLayerId() {
  return `tl_${Math.random().toString(36).slice(2, 9)}`;
}

// A text layer stores the raw headline string (`text`, which may contain ANY
// characters — spaces, punctuation, slashes, emoji) plus optional per-word
// styling (`styles[i]` = { color, size }). Words are derived from `text` only
// for layout/rendering, so editing the text never mangles what you typed.
function makeTextLayer(text = "Your headline here") {
  return { id: newLayerId(), x: 50, y: 14, align: "center", text, styles: [], font: DEFAULT_FONT, weight: DEFAULT_WEIGHT, italic: false, underline: false };
}

// Layer-level typography (font family + weight + italic + underline) with
// sensible defaults, applied to every word in the layer.
function layerFont(layer) {
  return {
    font: layer?.font || DEFAULT_FONT,
    weight: Number(layer?.weight) || DEFAULT_WEIGHT,
    italic: Boolean(layer?.italic),
    underline: Boolean(layer?.underline)
  };
}

function layerText(layer) {
  return typeof layer?.text === "string" ? layer.text : "";
}

// Split into display words. Preserves nothing but whitespace collapsing (each
// visible token becomes a positioned word); per-word style comes from styles[i].
function layerWords(layer) {
  const tokens = String(layer?.text || "").split(/\s+/).filter(Boolean);
  const styles = Array.isArray(layer?.styles) ? layer.styles : [];
  const list = tokens.length ? tokens : [""];
  return list.map((t, i) => ({ t, color: styles[i]?.color || "#ffffff", size: Number(styles[i]?.size) || DEFAULT_TEXT_SIZE }));
}

// Migrates any older layer shape (per-word array, or single text+color+size)
// into the raw-text + styles model.
function normalizeLayer(layer) {
  const base = {
    id: layer?.id || newLayerId(),
    x: layer?.x ?? 50,
    y: layer?.y ?? 14,
    align: "center",
    font: layer?.font || DEFAULT_FONT,
    weight: Number(layer?.weight) || DEFAULT_WEIGHT,
    italic: Boolean(layer?.italic),
    underline: Boolean(layer?.underline)
  };
  if (typeof layer?.text === "string" && !Array.isArray(layer?.words)) {
    return { ...base, text: layer.text, styles: Array.isArray(layer.styles) ? layer.styles : [] };
  }
  if (Array.isArray(layer?.words) && layer.words.length) {
    return {
      ...base,
      text: layer.words.map((w) => w.t ?? "").join(" "),
      styles: layer.words.map((w) => ({ color: w.color || "#ffffff", size: Number(w.size) || DEFAULT_TEXT_SIZE }))
    };
  }
  return { ...base, text: typeof layer?.text === "string" ? layer.text : "Your headline", styles: [] };
}

function clipView(clip = {}, project) {
  const source = Array.isArray(clip.textLayers) && clip.textLayers.length
    ? clip.textLayers
    : [{ id: "tl_default", text: clip.headline ?? project.headline ?? "Your headline", x: 50, y: 14 }];
  return {
    textLayers: source.map(normalizeLayer),
    zoom: Number(clip.zoom) || 2,
    panX: Number(clip.panX) || 0,
    panY: Number(clip.panY) || 0,
    trimStart: clip.trimStart ?? 0,
    trimEnd: clip.trimEnd ?? "",
    skipOriginal: clip.skipOriginal ?? false
  };
}

function Editor({ project, projects = [], templates, assets = [], onChange, onRender, onUploadOutro, onResume, onClearProject, retentionHours }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeLayerId, setActiveLayerId] = useState(null);
  const [activeWord, setActiveWord] = useState(0);
  const canvasRef = useRef(null);

  if (!project) {
    return (
      <div className="empty-state">
        <Film size={42} />
        <h1>Create or select a project to open the editor.</h1>
        {projects.length > 0 && (
          <div className="resume-list">
            <p className="eyebrow">Resume a saved project (kept for {retentionHours}h after last edit)</p>
            {projects.slice(0, 6).map((item) => (
              <button key={item.id} className="resume-item" onClick={() => onResume(item)}>
                <strong>{item.name}</strong>
                <span>{(item.clips || []).length} reel(s) · edited {new Date(item.updatedAt || item.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const clips = project.clips || [];
  const index = Math.min(activeIndex, Math.max(0, clips.length - 1));
  const activeClip = clips[index] || {};
  const view = clipView(activeClip, project);
  const layers = view.textLayers;
  const currentTemplate = templates.find((template) => template.id === project.template);
  const outro = project.outro || { enabled: false, durationSec: 2 };
  const selectedLayerId = activeLayerId && layers.some((layer) => layer.id === activeLayerId) ? activeLayerId : layers[0]?.id;
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) || layers[0];

  function patchClip(partial) {
    const nextClips = clips.map((clip, i) => (i === index ? { ...clip, ...partial } : clip));
    onChange({ ...project, clips: nextClips });
  }

  function setLayers(nextLayers) {
    patchClip({ textLayers: nextLayers });
  }

  function patchLayer(id, partial) {
    setLayers(layers.map((layer) => (layer.id === id ? { ...layer, ...partial } : layer)));
  }

  // Whole-headline editing: type ANY characters freely; words re-tokenize + wrap
  // from this raw text, and per-word styles keep their slots by index.
  function setLayerText(layerId, text) {
    patchLayer(layerId, { text });
  }

  // Per-word styling writes into styles[wordIndex]; the words themselves come
  // from the raw text so styling never edits the typed characters.
  function patchWord(layerId, wordIndex, partial) {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    const count = layerWords(layer).length;
    const styles = Array.from({ length: count }, (_, i) => ({ ...(layer.styles?.[i] || {}) }));
    styles[wordIndex] = { ...styles[wordIndex], ...partial };
    patchLayer(layerId, { styles });
  }

  function applyToAllWords(layerId, partial) {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    const count = layerWords(layer).length;
    const styles = Array.from({ length: count }, (_, i) => ({ ...(layer.styles?.[i] || {}), ...partial }));
    patchLayer(layerId, { styles });
  }

  function addLayer() {
    const layer = makeTextLayer("New text");
    // Stagger each new layer so multiple text blocks don't stack on the same spot.
    layer.y = Math.min(72, 14 + layers.length * 16);
    setLayers([...layers, layer]);
    setActiveLayerId(layer.id);
    setActiveWord(0);
  }

  function deleteLayer(id) {
    const next = layers.filter((layer) => layer.id !== id);
    setLayers(next);
    setActiveLayerId(next[0]?.id || null);
    setActiveWord(0);
  }

  function patchProject(partial) {
    onChange({ ...project, ...partial });
  }

  async function chooseOutroFile(file) {
    if (!file) return;
    const asset = await onUploadOutro(file);
    patchProject({ outro: { ...outro, enabled: true, localPath: asset.localPath, previewUrl: asset.previewUrl, name: asset.filename } });
  }

  function selectOutroAsset(assetId) {
    if (!assetId) {
      patchProject({ outro: { ...outro, localPath: null, previewUrl: null, name: null } });
      return;
    }
    const asset = assets.find((item) => item.id === assetId);
    if (asset) patchProject({ outro: { ...outro, enabled: true, localPath: asset.localPath, previewUrl: asset.previewUrl, name: asset.filename } });
  }

  async function exportReel() {
    // Ensure web fonts are loaded so the rasterized overlay matches the preview.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // proceed with whatever is available
      }
    }
    const overlayImage = canvasRef.current?.exportOverlay?.() || null;
    onRender({
      clipId: activeClip.id || activeClip.clipId,
      trimStart: Number(view.trimStart) || 0,
      trimEnd: view.trimEnd === "" || view.trimEnd === null ? null : Number(view.trimEnd),
      skipOriginal: Boolean(view.skipOriginal),
      zoom: view.zoom,
      panX: view.panX,
      panY: view.panY,
      overlayImage,
      outro: outro.enabled
        ? { enabled: true, durationSec: Number(outro.durationSec) || 2, localPath: outro.localPath || null }
        : null
    });
  }

  const videoAssets = assets.filter((asset) => asset.type === "video");
  const panDisabled = view.skipOriginal;
  const selectedLayerWords = selectedLayer ? layerWords(selectedLayer) : [];
  const selectedWordIndex = selectedLayer ? Math.max(0, Math.min(activeWord, selectedLayerWords.length - 1)) : 0;
  const selectedWord = selectedLayerWords[selectedWordIndex];

  // Direction pad nudges by a step (accumulates) instead of jumping to the edge,
  // so you can fine-tune position instead of being stuck at ±100.
  function nudge(axis, delta) {
    const key = axis === "x" ? "panX" : "panY";
    const current = axis === "x" ? view.panX : view.panY;
    const next = Math.max(-200, Math.min(200, current + delta));
    patchClip({ [key]: next });
  }

  return (
    <div className="editor">
      <section className="layers-panel">
        <h2><Layers size={18} /> Layers</h2>
        <div className="layer-list">
          <span className="layer-fixed">Video {view.skipOriginal ? "(hidden)" : `· zoom ${view.zoom.toFixed(2)}x`}</span>
          {currentTemplate?.assetUrl && currentTemplate?.assetType === "image" && (
            <span className="layer-fixed">Template {currentTemplate.contentBox ? "frame" : "overlay"} · {currentTemplate.name}</span>
          )}
          {layers.map((layer, i) => (
            <button
              key={layer.id}
              type="button"
              className={`layer-item ${layer.id === selectedLayerId ? "active" : ""}`}
              onClick={() => { setActiveLayerId(layer.id); setActiveWord(0); }}
            >
              <span className="layer-item-dot" style={{ background: layerWords(layer)[0]?.color || "#ffffff" }} />
              <span className="layer-item-label">Text {i + 1}: {layerText(layer) || "empty"}</span>
            </button>
          ))}
          <span className={outro.enabled ? "layer-fixed layer-active" : "layer-fixed"}>Outro {outro.enabled ? "(on)" : "(off)"}</span>
        </div>
        <button type="button" className="add-layer" onClick={addLayer}><Plus size={16} /> Add text layer</button>
        <h2 style={{ marginTop: 16 }}><Film size={18} /> Reels ({clips.length})</h2>
        <div className="clip-switcher">
          {clips.map((clip, i) => (
            <button
              key={clip.id || clip.clipId || i}
              className={i === index ? "active" : ""}
              onClick={() => setActiveIndex(i)}
              title={clip.title || clip.filename}
            >
              {i + 1}. {(clip.title || clip.filename || "clip").slice(0, 16)}{clipView(clip, project).skipOriginal ? " (skip)" : ""}
            </button>
          ))}
        </div>
      </section>
      <section className="canvas-zone">
        <KonvaCanvas
          ref={canvasRef}
          key={activeClip.id || activeClip.clipId || index}
          clip={activeClip}
          template={currentTemplate}
          textLayers={layers}
          selectedLayerId={selectedLayerId}
          selectedWordIndex={selectedWordIndex}
          zoom={view.zoom}
          panX={view.panX}
          panY={view.panY}
          skipOriginal={Boolean(view.skipOriginal)}
          trimStart={view.trimStart}
          trimEnd={view.trimEnd}
          onSelectLayer={(id) => { setActiveLayerId(id); setActiveWord(0); }}
          onSelectWord={(id, wordIndex) => { setActiveLayerId(id); setActiveWord(wordIndex); }}
          onLayerChange={patchLayer}
        />
        <Timeline project={project} />
      </section>
      <section className="tools">
        <header>
          <p className="eyebrow">Reel {index + 1} of {clips.length}</p>
          <h1>{activeClip.title || activeClip.filename || project.name}</h1>
        </header>
        <RetentionNotice hours={retentionHours}>
          Edits save automatically. You can stop and resume this project from the Dashboard for up to {retentionHours} hours after your last change.
        </RetentionNotice>
        <div className="clip-nav">
          <button disabled={index === 0} onClick={() => setActiveIndex(index - 1)}>Prev reel</button>
          <button disabled={index >= clips.length - 1} onClick={() => setActiveIndex(index + 1)}>Next reel</button>
        </div>
        <button
          type="button"
          className="danger clear-edit-btn"
          onClick={() => onClearProject?.(project.id)}
        >
          <Trash2 size={16} /> Clear this edit
        </button>

        <div className="frame-controls">
          <div className="layer-editor-head"><span>Frame the video</span></div>
          <label>Zoom ({view.zoom.toFixed(2)}x)
            <input type="range" min="0.3" max="4" step="0.05" value={view.zoom} disabled={view.skipOriginal} onChange={(event) => patchClip({ zoom: Number(event.target.value) })} />
          </label>
          <div className="dir-pad">
            <button type="button" disabled={panDisabled} onClick={() => nudge("y", -10)} className={view.panY < 0 ? "active" : ""}>Top</button>
            <div className="dir-mid">
              <button type="button" disabled={panDisabled} onClick={() => nudge("x", -10)} className={view.panX < 0 ? "active" : ""}>Left</button>
              <button type="button" disabled={panDisabled} onClick={() => patchClip({ panX: 0, panY: 0 })}>Center</button>
              <button type="button" disabled={panDisabled} onClick={() => nudge("x", 10)} className={view.panX > 0 ? "active" : ""}>Right</button>
            </div>
            <button type="button" disabled={panDisabled} onClick={() => nudge("y", 10)} className={view.panY > 0 ? "active" : ""}>Down</button>
          </div>
          <div className="trim-row">
            <label>Position X ({view.panX})
              <input type="range" min="-200" max="200" value={view.panX} disabled={panDisabled} onChange={(event) => patchClip({ panX: Number(event.target.value) })} />
            </label>
            <label>Position Y ({view.panY})
              <input type="range" min="-200" max="200" value={view.panY} disabled={panDisabled} onChange={(event) => patchClip({ panY: Number(event.target.value) })} />
            </label>
          </div>
          <p className="hint">Zoom below 1x shows more of the video (padding). Position runs -200 to 200; ±100 reaches the edges, beyond that pushes the video partly off-frame.</p>
        </div>

        {selectedLayer && (
          <div className="layer-editor">
            <div className="layer-editor-head">
              <span>Text layer {layers.length > 1 ? `(${layers.findIndex((l) => l.id === selectedLayer.id) + 1} of ${layers.length})` : ""}</span>
              {layers.length > 1 && (
                <button className="danger" type="button" onClick={() => deleteLayer(selectedLayer.id)}><Trash2 size={14} /> Delete layer</button>
              )}
            </div>
            <label className="headline-field">Headline text (wraps automatically)
              <textarea
                className="headline-input"
                rows={2}
                value={layerText(selectedLayer)}
                placeholder="Type your headline — it wraps to fit the frame"
                onChange={(event) => setLayerText(selectedLayer.id, event.target.value)}
              />
            </label>
            <div className="font-toolbar">
              <select
                className="font-select"
                value={selectedLayer.font || DEFAULT_FONT}
                style={{ fontFamily: selectedLayer.font || DEFAULT_FONT }}
                onChange={(event) => patchLayer(selectedLayer.id, { font: event.target.value })}
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.label} value={option.css} style={{ fontFamily: option.css }}>{option.label}</option>
                ))}
              </select>
              <div className="weight-group">
                {WEIGHT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={(Number(selectedLayer.weight) || DEFAULT_WEIGHT) === option.value ? "active" : ""}
                    style={{ fontWeight: option.value }}
                    title={`${option.label} weight`}
                    onClick={() => patchLayer(selectedLayer.id, { weight: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`fmt-btn ${selectedLayer.italic ? "active" : ""}`}
                style={{ fontStyle: "italic" }}
                title="Italic"
                onClick={() => patchLayer(selectedLayer.id, { italic: !selectedLayer.italic })}
              >
                I
              </button>
              <button
                type="button"
                className={`fmt-btn ${selectedLayer.underline ? "active" : ""}`}
                style={{ textDecoration: "underline" }}
                title="Underline"
                onClick={() => patchLayer(selectedLayer.id, { underline: !selectedLayer.underline })}
              >
                U
              </button>
            </div>
            <div className="word-rows">
              <span className="word-rows-title">Color &amp; size per word (optional)</span>
              {selectedLayerWords.map((word, i) => (
                <div key={i} className={`word-row ${i === selectedWordIndex ? "active" : ""}`} onClick={() => setActiveWord(i)}>
                  <span className="word-label" title={word.t}>{word.t || "—"}</span>
                  <input type="color" value={word.color} title="Word color" onChange={(event) => patchWord(selectedLayer.id, i, { color: event.target.value })} />
                  <input type="number" className="word-size" min="8" max="200" value={word.size} title="Word size (px)" onChange={(event) => patchWord(selectedLayer.id, i, { size: Number(event.target.value) || 8 })} />
                </div>
              ))}
            </div>
            <div className="word-actions">
              {selectedWord && (
                <>
                  <button type="button" onClick={() => applyToAllWords(selectedLayer.id, { color: selectedWord.color })}>Color to all</button>
                  <button type="button" onClick={() => applyToAllWords(selectedLayer.id, { size: selectedWord.size })}>Size to all</button>
                </>
              )}
            </div>
            <p className="hint">Pick a font, weight (Light / Normal / Bold), italic, or underline for this text layer. Type the headline above (default {DEFAULT_TEXT_SIZE}px white) and give any word its own color/size below. Drag the text on the canvas to move it.</p>
          </div>
        )}

        <label>Template
          <select value={project.template} onChange={(event) => patchProject({ template: event.target.value })}>
            {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
          </select>
        </label>
        <div className="layer-editor-head" style={{ marginTop: 12 }}><span>Crop the clip (keep only this time range)</span></div>
        <div className="trim-row">
          <label>Start at (s)
            <input type="number" min="0" step="0.1" value={view.trimStart} onChange={(event) => patchClip({ trimStart: event.target.value === "" ? 0 : Number(event.target.value) })} />
          </label>
          <label>End at (s)
            <input type="number" min="0" step="0.1" value={view.trimEnd} placeholder="clip end" onChange={(event) => patchClip({ trimEnd: event.target.value === "" ? "" : Number(event.target.value) })} />
          </label>
        </div>
        <p className="hint">This crops the clip in time — only the part between Start and End is exported. Example: Start 2, End 8 keeps seconds 2–8. Leave End blank to play to the end.</p>
        <label className="checkbox-row">
          <input type="checkbox" checked={Boolean(view.skipOriginal)} onChange={(event) => patchClip({ skipOriginal: event.target.checked })} />
          Skip original reel video (export overlay/outro only)
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={outro.enabled} onChange={(event) => patchProject({ outro: { ...outro, enabled: event.target.checked } })} />
          Append outro as last layer
        </label>
        {outro.enabled && (
          <div className="outro-controls">
            <span className="outro-current">{outro.localPath ? `Outro clip: ${outro.name || "selected"}` : "Outro: plain color tail (no clip selected)"}</span>
            {(outro.previewUrl || outro.localPath) && (
              <video className="outro-preview" src={mediaUrl(outro.previewUrl || (outro.localPath?.includes("defaults/outro") ? "/defaults/outro.mp4" : ""))} controls playsInline preload="metadata" />
            )}
            <label className="file-button">
              <Plus size={16} /> {outro.localPath ? "Change outro clip" : "Upload outro clip"}
              <input type="file" accept="video/*" onChange={(event) => chooseOutroFile(event.target.files[0])} />
            </label>
            {videoAssets.length > 0 && (
              <label>Or reuse a clip
                <select value={outro.localPath ? (videoAssets.find((a) => a.localPath === outro.localPath)?.id || "") : ""} onChange={(event) => selectOutroAsset(event.target.value)}>
                  <option value="">Plain color tail</option>
                  {videoAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
                </select>
              </label>
            )}
            {!outro.localPath && (
              <label>Outro duration (s)
                <input type="number" min="0.5" step="0.1" value={outro.durationSec} onChange={(event) => patchProject({ outro: { ...outro, durationSec: Number(event.target.value) || 2 } })} />
              </label>
            )}
          </div>
        )}
        <div className="export-settings">
          <span>MP4</span>
          <span>1080x1920</span>
          <span>H.264 / AAC</span>
        </div>
        <button type="button" className="primary" onClick={exportReel}><Wand2 size={18} /> Export this reel</button>
      </section>
    </div>
  );
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const PREVIEW = { width: 360, height: 640 };
const EXPORT_RATIO = 1080 / PREVIEW.width; // renders the overlay at true 1080x1920

function useHtmlImage(src) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    const handleLoad = () => setImage(img);
    img.addEventListener("load", handleLoad);
    img.src = src;
    return () => img.removeEventListener("load", handleLoad);
  }, [src]);
  return image;
}

let _measureCtx;
function measureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  return _measureCtx;
}

// Bumps a counter when web fonts finish loading so text re-measures and re-lays
// out with the correct metrics (otherwise the first paint uses fallback fonts).
function useFontTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts) return undefined;
    let active = true;
    const bump = () => active && setTick((value) => value + 1);
    fonts.ready?.then(bump);
    fonts.addEventListener?.("loadingdone", bump);
    return () => {
      active = false;
      fonts.removeEventListener?.("loadingdone", bump);
    };
  }, []);
  return tick;
}

// Flow words into centered lines within maxWidth, each word keeping its own size.
// Returns placed items with group-local x/y (line-centered), used for both the
// live preview and the exported overlay PNG (so per-word color/size are baked in).
function layoutWords(words, maxWidth, style = { font: DEFAULT_FONT, weight: DEFAULT_WEIGHT, italic: false }) {
  const ctx = measureCtx();
  const measure = (text, size) => {
    ctx.font = measureFont(style, size);
    return ctx.measureText(text || "").width;
  };
  const items = words.map((w, i) => ({ t: w.t || "", color: w.color || "#ffffff", size: Number(w.size) || DEFAULT_TEXT_SIZE, i, ww: measure(w.t, Number(w.size) || DEFAULT_TEXT_SIZE) }));
  const lines = [];
  let cur = [];
  let curW = 0;
  for (const it of items) {
    const spacer = cur.length ? measure(" ", it.size) : 0;
    if (cur.length && curW + spacer + it.ww > maxWidth) {
      lines.push({ items: cur, width: curW });
      cur = [];
      curW = 0;
    }
    it.sp = cur.length ? measure(" ", it.size) : 0;
    cur.push(it);
    curW += it.sp + it.ww;
  }
  if (cur.length) lines.push({ items: cur, width: curW });

  const placed = [];
  let y = 0;
  for (const ln of lines) {
    const maxSize = Math.max(1, ...ln.items.map((it) => it.size));
    const lineHeight = maxSize * 1.16;
    let x = -ln.width / 2;
    for (const it of ln.items) {
      x += it.sp;
      placed.push({ ...it, x, y: y + (maxSize - it.size) * 0.82 });
      x += it.ww;
    }
    y += lineHeight;
  }
  return placed;
}

function scaleBox(box, ratio) {
  return { x: box.x / ratio, y: box.y / ratio, w: box.w / ratio, h: box.h / ratio };
}

const KonvaCanvas = forwardRef(function KonvaCanvas(
  { clip, template, textLayers, selectedLayerId, selectedWordIndex, zoom, panX, panY, skipOriginal, trimStart, trimEnd, onSelectLayer, onSelectWord, onLayerChange },
  ref
) {
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [nativeSize, setNativeSize] = useState(null);
  const fontTick = useFontTick();

  const width = PREVIEW.width;
  const height = PREVIEW.height;

  const videoSrc = !skipOriginal && clip?.previewUrl ? mediaUrl(clip.previewUrl) : null;
  const templateUrl = template?.assetUrl && template?.assetType === "image" ? mediaUrl(template.assetUrl) : null;
  const boxMode = Boolean(template?.contentBox);
  // Legacy (no content box) image templates are baked into the Konva overlay.
  const legacyTemplateImg = useHtmlImage(boxMode ? null : templateUrl);
  const start = Number(trimStart) || 0;
  const end = trimEnd === "" || trimEnd === null || trimEnd === undefined ? null : Number(trimEnd);

  // The content box is where the video lives. Box templates place it inside their
  // frame; otherwise the video fills the whole canvas.
  const box = boxMode ? scaleBox(template.contentBox, EXPORT_RATIO) : { x: 0, y: 0, w: width, h: height };

  // Mirror the server framing exactly: cover-scale the FULL frame to the box,
  // then scale by zoom. z=1 fills the box, z>1 crops in, z<1 shows more of the
  // video with padding. We need the video's native size to keep the whole frame
  // visible (objectFit:fill on an aspect-correct box = no distortion, no crop).
  const z = Math.max(0.3, Number(zoom) || 1);
  let vw;
  let vh;
  if (nativeSize?.w && nativeSize?.h) {
    const cover = Math.max(box.w / nativeSize.w, box.h / nativeSize.h);
    const scale = cover * z;
    vw = nativeSize.w * scale;
    vh = nativeSize.h * scale;
  } else {
    vw = box.w * z;
    vh = box.h * z;
  }
  const ax = (Number(panX) || 0) / 100;
  const ay = (Number(panY) || 0) / 100;
  // left = (W - w) / 2 * (1 + ax), matching the server overlay expression.
  const videoStyle = {
    position: "absolute",
    width: `${vw}px`,
    height: `${vh}px`,
    left: `${((box.w - vw) / 2) * (1 + ax)}px`,
    top: `${((box.h - vh) / 2) * (1 + ay)}px`,
    objectFit: "fill"
  };
  const boxStyle = { position: "absolute", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, overflow: "hidden", zIndex: 1 };

  let legacyTemplateProps = null;
  if (!boxMode && legacyTemplateImg?.width) {
    const scale = Math.min(width / legacyTemplateImg.width, height / legacyTemplateImg.height);
    const w = legacyTemplateImg.width * scale;
    const h = legacyTemplateImg.height * scale;
    legacyTemplateProps = { image: legacyTemplateImg, x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, listening: false };
  }

  useImperativeHandle(ref, () => ({
    // Rasterize the text layers (and legacy template) to a transparent 1080x1920
    // PNG so the server can composite it on top of the framed video.
    exportOverlay() {
      const stage = stageRef.current;
      if (!stage) return null;
      // Hide editor-only chrome (the selected-word highlight box) so it never
      // bakes into the exported video.
      const chrome = stage.find(".editor-chrome");
      chrome.forEach((node) => node.hide());
      try {
        return stage.toDataURL({ pixelRatio: EXPORT_RATIO, mimeType: "image/png" });
      } catch {
        return null; // cross-origin template can taint the canvas; skip overlay
      } finally {
        chrome.forEach((node) => node.show());
      }
    }
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        video.currentTime = start;
      } catch {
        // currentTime may not be seekable until metadata loads.
      }
    }
  }, [start, end, videoSrc]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < start || (end !== null && video.currentTime >= end)) video.currentTime = start;
      video.play();
    } else {
      video.pause();
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    if (end !== null && video.currentTime >= end) {
      video.pause();
      video.currentTime = start;
      setPlaying(false);
    }
    setCurrent(video.currentTime);
  }

  return (
    <div className="editor-preview" data-font-tick={fontTick}>
      <div className="konva-shell">
        {boxMode && templateUrl && <img className="template-bg" src={templateUrl} alt="" />}
        <div style={boxStyle}>
          {videoSrc && (
            <video
              ref={videoRef}
              className="canvas-video"
              src={videoSrc}
              style={videoStyle}
              playsInline
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (!video) return;
                setDuration(video.duration || 0);
                if (video.videoWidth && video.videoHeight) setNativeSize({ w: video.videoWidth, h: video.videoHeight });
                try {
                  video.currentTime = start;
                } catch {
                  // ignore
                }
              }}
            />
          )}
          {!videoSrc && !skipOriginal && clip?.thumbnailUrl && <img className="canvas-video" src={mediaUrl(clip.thumbnailUrl)} alt="" style={{ ...videoStyle, objectFit: "cover" }} />}
          {skipOriginal && <div className="canvas-note">Original hidden</div>}
        </div>
        <Stage ref={stageRef} width={width} height={height} className="overlay-stage">
          <Layer>
            {legacyTemplateProps && <KonvaImage {...legacyTemplateProps} />}
            {textLayers.map((layer) => {
              const font = layerFont(layer);
              const placed = layoutWords(layerWords(layer), width * 0.94, font);
              const isSelectedLayer = layer.id === selectedLayerId;
              return (
                <Group
                  key={layer.id}
                  x={(layer.x / 100) * width}
                  y={(layer.y / 100) * height}
                  draggable
                  onDragEnd={(event) =>
                    onLayerChange(layer.id, {
                      x: Math.round((event.target.x() / width) * 100),
                      y: Math.round((event.target.y() / height) * 100)
                    })
                  }
                >
                  {placed.map((word) =>
                    isSelectedLayer && word.i === selectedWordIndex ? (
                    <Rect
                      key={`hl-${word.i}`}
                      name="editor-chrome"
                      x={word.x - 3}
                      y={word.y - 1}
                      width={word.ww + 6}
                      height={word.size * 1.12}
                      fill="rgba(15,143,126,0.28)"
                      stroke="#0f8f7e"
                      strokeWidth={1}
                      cornerRadius={3}
                      listening={false}
                    />
                    ) : null
                  )}
                  {placed.map((word) => (
                    <Text
                      key={word.i}
                      text={word.t}
                      x={word.x}
                      y={word.y}
                      fill={word.color}
                      fontSize={word.size}
                      fontFamily={font.font}
                      fontStyle={fontStyleString(font.weight, font.italic)}
                      textDecoration={font.underline ? "underline" : ""}
                      shadowColor="#000000"
                      shadowBlur={6}
                      shadowOpacity={0.55}
                      onMouseDown={() => onSelectWord(layer.id, word.i)}
                      onTouchStart={() => onSelectWord(layer.id, word.i)}
                    />
                  ))}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>
      {videoSrc ? (
        <div className="preview-controls">
          <button onClick={togglePlay} type="button">
            {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pause" : "Play"}
          </button>
          <progress value={duration ? (current / duration) * 100 : 0} max="100" />
          <span>{fmtTime(current)} / {fmtTime(duration)}{end !== null ? ` · trim ${start}s–${end}s` : start ? ` · from ${start}s` : ""}</span>
        </div>
      ) : (
        <div className="preview-controls muted">
          <span>{skipOriginal ? "Original skipped for this reel." : "No downloaded clip to play — download the reel or upload media to preview playback."}</span>
        </div>
      )}
    </div>
  );
});

function Timeline({ project }) {
  const tools = ["Trim", "Split", "Move", "Snap", "Ripple delete", "Zoom", "Seek", "Playback"];
  return (
    <div className="timeline-wrap">
      <div className="timeline-tools">
        {tools.map((tool) => <button key={tool}>{tool}</button>)}
      </div>
      <div className="timeline">
        {project.timeline?.map((track) => (
          <div className="track" key={track.id}>
            <strong>{track.name}</strong>
            <div>
              {(track.clips.length ? track.clips : [{ start: 0, duration: 4 }]).map((clip, index) => (
                <span key={index} style={{ width: `${Math.max(14, (clip.duration || 6) * 5)}%` }}>{clip.duration || 4}s</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportQueue({ jobs, onRefresh, onDeleteJob, retentionHours }) {
  const [busy, setBusy] = useState(false);
  const completed = jobs.filter((job) => job.status === "complete" && job.result?.outputUrl);

  const jobFilename = (job) => {
    // Strip any existing extension so we never get "name.mp4-stamp.mp4".
    const raw = String(job.clipTitle || job.projectId || "reel").replace(/\.[a-z0-9]+$/i, "");
    const base = raw.replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "reel";
    // Stamp is the moment of this download click (not the original export time),
    // so re-downloading after a refresh gets a fresh, sortable filename.
    const when = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = [
      when.getFullYear(),
      pad(when.getMonth() + 1),
      pad(when.getDate()),
      pad(when.getHours()),
      pad(when.getMinutes()),
      pad(when.getSeconds())
    ].join("-");
    return `${base}-${stamp}.mp4`;
  };

  async function download(job) {
    try {
      await downloadFile(job.result.outputUrl, jobFilename(job));
    } catch (error) {
      alert(error.message);
    }
  }

  async function downloadAll() {
    if (!completed.length) return;
    setBusy(true);
    try {
      for (const job of completed) {
        // Sequential saves so the browser doesn't drop concurrent downloads.
        // eslint-disable-next-line no-await-in-loop
        await downloadFile(job.result.outputUrl, jobFilename(job));
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <header>
        <div>
          <p className="eyebrow">Export queue — your finished videos</p>
          <h1>Preview and download your exported reels here. This is where every rendered video lands.</h1>
        </div>
        <div className="actions">
          <button onClick={onRefresh}><RefreshCcw size={18} /> Refresh</button>
          <button className="primary" onClick={downloadAll} disabled={!completed.length || busy}>
            <Download size={18} /> {busy ? "Downloading…" : `Download all (${completed.length})`}
          </button>
        </div>
      </header>
      <RetentionNotice hours={retentionHours}>
        Download your finished videos here (or grab them from <code>storage/renders/</code>). Exports auto-delete {retentionHours} hours after they finish.
      </RetentionNotice>
      {jobs.length === 0 && <p className="job-note">No exports yet. Open a reel in the Editor and click “Export this reel”.</p>}
      <div className="job-list">
        {jobs.map((job) => (
          <article key={job.id} className="job">
            <div>
              <strong>{job.clipTitle || job.projectId}</strong>
              <span>{job.status} · {new Date(job.createdAt).toLocaleString()}</span>
              {job.error && <span className="job-error">{job.error}</span>}
              {job.result?.note && <span className="job-note">{job.result.note}</span>}
            </div>
            {job.status === "complete" && job.result?.outputUrl ? (
              <div className="job-review">
                <video src={mediaUrl(job.result.outputUrl)} controls playsInline preload="metadata" />
                <button type="button" className="primary" onClick={() => download(job)}><Download size={16} /> Download this video</button>
              </div>
            ) : job.status === "failed" ? (
              <span className="job-error">Export failed — try again from the Editor.</span>
            ) : (
              <progress value={job.status === "complete" ? 100 : job.progress || 0} max="100" />
            )}
            <div className="actions">
              <button type="button" className="danger" onClick={() => onDeleteJob(job.id)}><Trash2 size={16} /> Remove</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SettingsPage({ users, onAddUser, onCookieUpload }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  async function submit(event) {
    event.preventDefault();
    await onAddUser({ name, email });
    setName("");
    setEmail("");
  }

  return (
    <div className="panel">
      <header>
        <div>
          <p className="eyebrow">Local settings</p>
          <h1>Manage local users, preferences, and future brand kit defaults.</h1>
        </div>
      </header>
      <form className="account-form" onSubmit={submit}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="User name" required />
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" required />
        <button type="submit"><User size={18} /> Add user</button>
      </form>
      <section className="surface">
        <h2>Instagram browser session</h2>
        <p>Upload a Netscape-format cookies.txt file exported from a browser session. Passwords are never stored.</p>
        <label className="file-button">
          <Clapperboard size={18} /> Upload cookies.txt
          <input type="file" accept=".txt" onChange={(event) => event.target.files[0] && onCookieUpload(event.target.files[0])} />
        </label>
      </section>
      <div className="account-grid">
        {users.map((user) => (
          <article className="account" key={user.id}>
            <strong>{user.name}</strong>
            <span>{user.email} · {user.preferences.theme}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
