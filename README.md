# SmartForgeReel Studio

SmartForgeReel Studio is a local-first web application for video editors and social-content teams. It combines Instagram content ingestion, video selection, local download tracking, asset management, reusable templates, a Canva-like vertical editor, and FFmpeg-backed exports. Install, start the app, add templates from the **Templates** tab, and begin editing — no manual server-side file setup is required.

## Current Build

- Dashboard with project, library, template, and export metrics
- **Users (Settings).** Add, edit (name, email, theme, language), and delete local users.
- Multiple Instagram source accounts, each editable and deletable
- Live public-reel scraping by handle (no login or cookies.txt required), manual reel URL mode, and a mock adapter
- Handle is optional when reel URLs are pasted (source is labelled `manual-reels`)
- URL sources title each video as `manual-reels-{reel id from the URL}`
- Fetches the top 10-20 videos per channel, ordered newest first (today, then yesterday, and so on)
- Latest video selection; non-selected videos are discarded when you proceed to edit
- Download manager records for selected videos
- Real `yt-dlp` download bridge with failure tracking
- Upload fallback for local video, image, and audio media
- Library with search and multi-select
- Create, edit, and delete your own templates in the app; built-in **Clean (full frame)** is always available and cannot be deleted
- Optional file-based **Default frame** presets appear in Templates only when matching PNGs exist under `server/assets/defaults/` (for advanced / self-hosted setups)
- Routed web app modules for Dashboard, Instagram, Library, Templates, Editor, Export Queue, and Settings
- 1080 x 1920 Canva-style editor: per-word colored/sized headlines (each word independently styleable, down to a single letter), draggable text layers, and framed layouts that show the reel inside your template’s video area
- Optional vertical frame and outro files in `server/assets/defaults/` (gitignored, not required to use the product)



## Templates and branding

**Normal workflow:** open **Templates → Add template**, upload your PNG, and click **Use** when starting a project. Add an outro anytime in the **Editor** (upload or pick from the Library). **Clean (full frame)** is seeded automatically so new projects always have a full-bleed layout.

**Built-in vs custom:** templates that ship with the app (Clean, and optional file-based frames) **cannot be deleted** in the UI. Templates you create yourself can be edited or removed anytime.

**Optional** `server/assets/defaults/` **(advanced):** for teams who want frames auto-loaded from disk (with a configured **video window** rectangle for exact placement), you can place gitignored files there. This is **not** part of the everyday user flow — the public repo ships without those binaries.


| If files are…       | What happens                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Missing**         | Server starts normally. **Clean (full frame)** is the default for new projects. Outro is off until you attach one in the Editor. Add templates only via the UI. |
| **Present locally** | After restart, **Default frame** / **Default frame (classic)** also appear as undeletable built-ins; new projects prefer the main frame when available.         |


**Publishing the repo:** `template.png`, `template-classic.png`, and `outro.mp4` stay **gitignored** so you never commit third-party brand media.

### Optional files in `server/assets/defaults/`

SmartForgeReel always includes **Clean (full frame)**. These files are optional and **gitignored**:


| File                   | Purpose                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `template.png`         | Main vertical frame (1080×1920 PNG). The reel is drawn inside the transparent or cut-out video window on the frame. |
| `template-classic.png` | Alternate frame (second preset).                                                                                    |
| `outro.mp4`            | Default outro appended to new projects (vertical MP4).                                                              |


1. Copy files into `server/assets/defaults/`.
2. Restart the server.
3. **Templates** lists **Default frame** / **Default frame (classic)** when matching files exist.

**Video window (file-based frames only):** if you use the defaults folder and the reel should sit in a different rectangle, update `DEFAULT_CONTENT_BOX` and `CLASSIC_CONTENT_BOX` in `server/src/defaults.js` (`{ x, y, w, h }` on a 1080×1920 canvas), then restart. Templates uploaded through the UI do not use these values unless you extend the app yourself.

- Frame the video with zoom (1x–3x) and directional Top/Down/Left/Right positioning inside the template box
- Edit selected reels one by one, each with its own text layers, framing, trim, and skip settings
- **Export matches the editor preview:** text is saved as a PNG overlay and merged with the video, so the downloaded file looks like what you saw on the canvas (no separate subtitle engine in FFmpeg)
- Per-reel trim start and trim end with float-second precision
- Skip-original-reel option to export overlay/outro only
- Outro appended as the last layer of the exported video
- Upload a custom file (image/video) when creating or editing a template
- Outro clip is selectable and changeable anytime — upload one or reuse a library clip, or fall back to a plain color tail
- Export queue backed by a local FFmpeg render service
- Downloaded reel source files are removed after export (not kept forever)
- Automatic retention: fetched reels, downloaded clips, uploads, and exports all auto-delete after 6 hours (configurable) so storage never grows
- Projects are saved automatically and can be resumed from the Dashboard within the retention window
- SQLite persistence in `storage/smartforgereel.sqlite` with `storage/db.json` kept as a readable mirror



## Tech Stack

- React + Vite frontend
- Node.js + Express backend
- SQLite storage in `storage/smartforgereel.sqlite`
- FFmpeg adapter through `fluent-ffmpeg`
- `yt-dlp` bridge for downloads
- Multer upload pipeline for local media

This version is intentionally web-first. It does not use Electron.

## Instagram Access

Instagram access is implemented behind `server/src/instagram.js`.

Current modes:

- `live` (default for handle accounts): scrapes a public account's most recent reels using Instagram's public mobile endpoints (`i.instagram.com`), newest first. No login or `cookies.txt` is needed. It paginates until at least ~12 video reels are collected, so image/carousel posts in between are skipped automatically.
- `urls`: accepts pasted public reel URLs
- `mock`: generates realistic sample records for product development (offline/demo)
- `session`: reserved for a future browser-session adapter

Notes on `live` mode:

- Works for public accounts only. Private accounts, or accounts temporarily rate-limited by Instagram, are reported per-account in the fetch result while the other accounts still load.
- Downloads still go through `yt-dlp` against the public reel URL and also work without cookies. If you ever need cookies for a restricted download, drop a Netscape `cookies.txt` at `storage/cache/instagram-cookies.txt` and it will be used automatically; otherwise it is ignored.
- Tested against multiple public Instagram accounts (about 12 reels each, newest first).

Production options:

- Use an approved scraping/downloader provider.
- Use `yt-dlp` for supported public URLs.
- Use Playwright session extraction only when legally and operationally acceptable.
- Do not store Instagram passwords.



## Requirements

- Node.js 20+
- npm 10+
- FFmpeg installed locally for real rendering
- yt-dlp installed locally for public URL downloads

On macOS:

```bash
brew install ffmpeg
brew install yt-dlp
```



## Steps to follow setup on local:

1. Install dependencies:

```bash
npm install
```

1. Create the local server environment file:

```bash
cp server/.env.example server/.env
```

1. Start the local app.

Option A — run both together in one command:

```bash
npm run dev
```

Option B — run the server and client independently in two terminals (recommended for local dev, so restarting or crashing one does not stop the other):

```bash
# Terminal 1: Express API on port 4000
npm run dev:server
```

```bash
# Terminal 2: Vite client on port 5173
npm run dev:client
```

1. Open the web app:

```text
http://localhost:5173
```

1. The API runs locally at:

```text
http://127.0.0.1:4000
```

The app uses two local ports:

- `5173` is the Vite client web app.
- `4000` is the Express server API. The client calls this API for projects, uploads, downloads, renders, and SQLite-backed data.

You can change the server port if needed. Update `server/.env`:

```bash
PORT=4001
HOST=127.0.0.1
CLIENT_ORIGIN=http://localhost:5173
```

Then create or update `client/.env` so the browser points to the new API port:

```bash
VITE_API_BASE=http://127.0.0.1:4001
```

Restart the app after changing either env file (restart `npm run dev`, or the individual `npm run dev:server` / `npm run dev:client` process).

1. If port `4000` is already in use, stop the old server process. First try pressing `Ctrl+C` in the terminal where the server is running. If you do not know which terminal is running it, find and stop the process:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
kill <PID>
```

For example, if the command shows PID `94223`:

```bash
kill 94223
```

Then start the app again:

```bash
npm run dev
```



## Product Requirements

The product implements this end-to-end flow:

1. Configure multiple public Instagram accounts (handle optional when reel URLs are pasted).
2. On fetch, pull the top 10-20 videos per channel, ordered newest first (today, yesterday, the day before, ...).
3. Select the videos to edit and proceed; the non-selected videos are discarded.
4. Edit the selected reels one by one (headline, template, caption, and per-reel options), similar to a Canva-style editor.
5. Create, edit, and delete custom templates.
6. Export each reel with FFmpeg.
7. Downloaded sources stay available for re-editing until the retention window removes them (default 6 hours after download).

Per-reel editing requirements:

- **Skip original reel video** — a per-reel toggle to exclude the original clip and export only the overlay/outro layers.
- **Trim start and trim end** — per-reel in/out points that accept float values in seconds (for example `1.5`, `8.25`).
- **Outro as the last layer** — the exported video ends with an outro segment appended as the final layer. You can **upload an outro clip, reuse a clip from the library, or change it at any time**; with no clip selected it uses a plain color tail of a configurable duration.
- **Template file** — when creating or editing a template you can **upload a file** (image or video) that is stored with the template and shown in its preview.



## Data retention (default: 6 hours)

Working data is **temporary** so disk use stays bounded. A background job runs when the server starts and **every 10 minutes**. Anything older than the window is removed from `storage/db.json` and `storage/smartforgereel.sqlite` (both stay in sync) and its files are deleted when paths are known.


| What                                                                                  | When it is removed                                                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Fetched reels** (Instagram tab list)                                                | `createdAt` older than the window                                                                                           |
| **Download records + library video files** (`storage/downloads/`)                     | `createdAt` on the download/asset older than the window                                                                     |
| **Uploaded library files** (`storage/uploads/`)                                       | `createdAt` on the asset older than the window                                                                              |
| **Export queue jobs + rendered files** (`storage/renders/`)                           | `completedAt` (or `createdAt` if still in progress) older than the window                                                   |
| **Editor projects**                                                                   | `updatedAt` (or `createdAt`) older than the window — editing a project resets the clock so you can resume within the window |
| **Loose files** in `downloads`, `uploads`, `renders`, `exports`, `thumbnails`, `temp` | File modification time older than the window (cleans orphans even if a DB row was already gone)                             |


**What is not removed by this sweep:** Instagram **accounts** you saved, **users/settings**, and **templates** (including files under `storage/templates/`). Custom templates you added in the app remain until you delete them.

Exports do **not** delete your downloaded reel the instant you render; you can tweak and export again until retention removes those records and files.

The window is set with `RETENTION_HOURS` in `server/.env` (default `6`; try `24` for a full day). The active value appears in the app and at `GET /api/config`.

### How the 6-hour sweep works (step by step)

1. **Timer** — On server start, `purgeExpired()` runs once, then again every **10 minutes**.
2. **Cutoff** — `cutoff = now − RETENTION_HOURS` (default 6 hours).
3. **Database** — For each row in `db.json` / SQLite, compare the timestamp in the table below. Expired rows are **removed from both** stores in the same pass.
4. **Linked files** — When a removed row stores a file path (`localPath`, render `outputPath`, etc.), that file is deleted from disk.
5. **Orphans** — Files under `downloads`, `uploads`, `renders`, `exports`, `thumbnails`, and `temp` whose **mtime** is older than the cutoff are deleted even if no DB row remains (prevents disk clutter).
6. **Not swept** — Saved Instagram **accounts**, **users**, **templates** (and `storage/templates/` media for custom templates) are kept until you delete them in the UI.

### Manual deletion (immediate, not waiting 6 hours)

| Action | What it removes |
|--------|------------------|
| **Settings → Delete user** | That user record only |
| **Instagram → Delete** on a source | Source + its fetched videos in the DB |
| **Clear fetched videos** | All rows in the fetched-reels list (not library files) |
| **Clear all handles** | All sources + all fetched reels |
| **Library → Clear library** | All library assets + download records + their files |
| **Library → delete one asset** | That asset row (file may remain until retention if path cleanup missed) |
| **Export Queue → Remove** | That job + its rendered MP4 |
| **Editor → Clear this edit** | Current project only |
| **`POST /api/maintenance/reset-content`** | Videos, downloads, library assets, projects, export jobs, and working folders — **keeps** accounts, users, and built-in templates |

### Resetting or deleting the `storage/` folder

**Yes, you can wipe local data** — useful for a fresh start or if something looks corrupted.

1. **Stop the server** (Ctrl+C on `npm run dev` or your process).
2. Delete the whole `storage/` directory, or only `storage/db.json` and `storage/smartforgereel.sqlite` if you also want to clear the catalog but keep media files on disk.
3. Start the server again.

On startup the app **recreates** missing folders under `storage/`, writes a **new empty database** if `db.json` is missing, rebuilds SQLite from that data, and **re-seeds built-in templates** (Clean, plus file-based defaults if optional PNGs exist). You will lose **projects, library items, export queue, fetched reels, and saved Instagram accounts** that lived in the old database — that is expected after a full wipe.

If you delete **media files** manually but leave old rows in `db.json`, the UI may show broken entries until those rows age out and the retention sweep removes them, or until you use **Clear library** / `POST /api/maintenance/reset-content` to reset working content without deleting accounts (reset-content keeps default templates and accounts).

### Why is there a Library?

The Library is a **temporary staging area**, not permanent storage. It holds the actual media files the editor pulls clips from: reels you downloaded plus any local files you uploaded. Fetched-but-not-downloaded reels do **not** appear here — they live in the Instagram tab until you download them. Both downloaded reels and uploads in the Library expire on the schedule above.

## How to Use (End-to-End Process)

Follow these steps in order. This is the full flow from adding Instagram sources to exporting a finished reel.

### 1. Open the app

- Start with `npm run dev` and open `http://localhost:5173`.
- The Dashboard shows counts for projects, library assets, export queue, and templates.



### 2. Add one or more Instagram handles (Instagram page)

- Go to the **Instagram** tab.
- Add each public handle you want to source from (for example `yourbrand`). You can add multiple handles.
- The handle is **optional if you paste reel URLs** instead. URL-only sources are labelled `manual-reels`.
- Each account can be **edited or deleted**, and you can clear all handles or clear fetched videos with one click.
- Mode is chosen automatically:
  - `live` (default when you enter a handle): scrapes that public account's most recent reels directly from Instagram, no login or cookies needed.
  - `urls`: paste public reel URLs (one per line); each video is titled `manual-reels-{reel id from the URL}` (for example `https://www.instagram.com/p/Da2tMkDN6wa/` -> `manual-reels-Da2tMkDN6wa`).
  - `mock`: sample videos for offline/demo work.



### 3. Fetch the latest videos

- On each source card, check **Include in fetch** (use **Select all** / **Select none** to choose many at once). **Fetch latest (N)** only runs for checked sources — you can keep 10 handles on file and refresh 3 today.
- Click **Fetch latest**. For a live handle the app pulls that account's most recent reels (about 12, ordered newest first). Re-fetching a source replaces that source's previous fetched list; other sources' videos stay until retention or **Clear fetched videos**.
- **Manual reel URLs** use Instagram's oEmbed API for the preview image when available (no random stock photos). If Instagram does not return a thumbnail, the grid shows a labeled placeholder until you download the reel.
- Each account is fetched independently. If one account is private or briefly rate-limited by Instagram, you get an on-screen note for that handle while the others still load.



### 4. Select videos

- Select the videos you want to edit. When you proceed to the editor, the **non-selected videos are discarded**.



### 5. Download selected videos

- Click **Download selected**. This uses `yt-dlp` to fetch each video into `storage/downloads/` and adds it to your Library.
- Live and `urls` reels download without cookies. In `mock` mode the sample URLs are placeholders, so those downloads report `failed` by design — this does not block the rest of the flow.



### 6. Upload local media (fallback)

- In the **Library** tab you can upload your own local video, image, or audio files.
- Use this when a download is not available or when you want to edit media you already have.



### 7. Browse and manage the Library

- The **Library** tab lists every downloaded and uploaded asset.
- Search by filename or tag, multi-select assets, rename, or delete.



### 8. Manage templates (create / edit / delete)

- The **Templates** tab lists built-in **Default frame**, **Default frame (classic)** (when optional files exist), and **Clean (full frame)**. Built-ins cannot be deleted.
- You can **create your own template** (name, category, accent color, components), **edit** any custom template, and **delete** templates you added.
- Choosing **Use** on a template sets the look for the project you create next.



### 9. Create a project

- Create a project from either selected videos or selected library assets.
- The project opens in the **Editor** with a 1080 x 1920 vertical canvas, a headline overlay, layers, and a basic timeline.



### 10. Edit the selected reels one by one

- The Editor shows every selected reel in a switcher; edit them **one at a time**.
- Each reel is a **playable preview**: use the Play/Pause control under the canvas to watch it. Playback respects your trim range, so pressing Play previews exactly the segment that will export. (Playback needs a local file — download the reel or upload media first; fetched-only reels show the thumbnail.)
- **Built-in templates.** When optional files exist under `server/assets/defaults/`, **Default frame** is auto-selected for new projects; **Default frame (classic)** is also listed. **Clean (full frame)** is always available (full-bleed preview). All built-ins are undeletable; add your own via **Templates**.
- **Video inside the frame.** On layouts that define a video window, the reel is drawn **inside that rectangle** and your frame artwork (logo, bars, borders) stays around it. For optional file-based defaults, that rectangle is set in `server/src/defaults.js`.
- **Multiple text layers.** The left panel lists every layer: the video, the template, and each text layer. Click a layer to select it. Click **Add text layer** to add another headline block — each new layer drops in slightly lower so they don't stack on top of each other, and you can drag any layer anywhere on the canvas. Add as many layers as you want; each has its own text, colors, sizes, and position. Select a layer and use **Delete layer** to remove it (the last remaining layer can't be deleted).
- **Type the whole headline; it wraps automatically.** Each text layer has a single **Headline text** box — type your full headline and it word-wraps to fit the frame (no more adding words one at a time). It accepts **any characters**: spaces, punctuation, slashes/backslashes, dots, numbers, emoji — everything. The default text is **28px, white**.
- **Fonts & formatting.** Each text layer has a **font picker (20 styles)** — system fonts plus Google fonts (Roboto, Montserrat, Poppins, Oswald, Bebas Neue, Anton, Playfair Display, Merriweather, and more) — a **weight toggle (Light / Normal / Bold)** for a lighter or darker feel, plus **Italic** and **Underline**. These apply to the whole layer and are baked into the export exactly as previewed (fonts are loaded before the overlay is rasterized).
- **Per-word color & size (optional).** Below the headline box, every word is listed with its own color picker and size. Recolor just the words you want (e.g. one word gold), or use **Color to all / Size to all**. Editing colors/sizes never changes the text you typed. Drag the text on the canvas to reposition it.
- **The default framing is Zoom 2, centered** (Position X 0, Position Y 0), since that matches most edits. Adjust it per reel with the **Zoom** slider (**0.3x–4x**) and the **Top / Down / Left / Right / Center** pad — the pad nudges the position in steps so you can fine-tune. **Zoom below 1x shows a larger portion of the video** (the whole frame, with padding around it). **Position X/Y run −200…200**: ±100 reaches the edges of the zoomed video, and beyond that pushes the video partly off-frame. The preview direction matches the export, and the selected-word highlight never bakes into the export.
- **Export matches the preview.** Text is captured from the canvas as a 1080×1920 PNG and merged into the final video, so colors, sizes, and positions match what you edited.
- **Crop the clip (Start at / End at).** These fields **crop the clip in time** — only the part between *Start at* and *End at* seconds is exported (e.g. Start 2, End 8 keeps seconds 2–8). Leave *End at* blank to play to the end. Values accept decimals like `0.5`.
- **Skip original reel video** exports only the template/text/outro for that reel (the preview hides the video to match).
- **Append outro** adds the outro segment as the last layer (defaults to the shared `outro.mp4`; you can upload or reuse another clip). When an outro is attached you can **preview and play it right in the editor**. The reel's audio is preserved through the outro tail.



### 11. Export (render) each reel

- Click **Export this reel** for the reel you are editing. The job appears in the **Export Queue** tab. Repeat per reel.
- Rendering uses FFmpeg: template image as background, video scaled/cropped to your zoom and framing and placed in the template’s video window, text PNG on top, trim applied, outro appended. Output goes to `storage/renders/` (one file per export job).
- **The Export Queue is where your finished videos live — it is the final download place.** When a job completes it plays the **finished video inline** so you can review it.
- **Every export is its own entry + file.** Exporting reel 1 then reel 2 produces **two separate jobs and two separate files** (keyed by job id) — they no longer overwrite each other. Each downloads with a distinct filename.
- **Download to your computer.** Click **Download this video** on any completed job to save that single reel, or **Download all** in the header to save every completed reel one after another. Filenames are `<title>-YYYY-MM-DD-HH-MM-SS.mp4` stamped at the moment you click download (e.g. `vid_zPKShM1OR4-2026-07-20-02-33-15.mp4`), so re-downloads get a fresh name and are easy to find in any folder.
- **Remove** deletes a job from the queue and its rendered file. (There is no pause/resume — local renders finish in seconds, so those controls were removed.)
- **Re-editable after export.** The downloaded source is **not** deleted the moment you export, so you can reopen the project, tweak, and export again. All working content (downloads, uploads, projects, jobs) is instead cleared by the retention sweep (`RETENTION_HOURS`, default 6h).
- **Clear Library.** Use **Clear library** on the Library page (with a confirm dialog). It removes downloaded/uploaded Library media only — editor projects and the Export Queue stay. Use **Clear this edit** in the Editor to drop the current project (Prev/Next reels). Export Queue already has per-job **Remove**. Full wipe of working content is still available as `POST /api/maintenance/reset-content` if you ever need it.



### Notes verified during testing

- The full flow above (multiple handles -> discover -> select -> upload -> library -> template CRUD -> project -> per-reel edit with trim/skip/outro -> render/export -> source cleanup) has been tested end-to-end against the API.
- Real video export requires the reel to have local media (an uploaded file, or a downloaded reel from a real public URL). Mock handles use placeholder URLs, so their downloads fail by design; a mock reel with no local file produces a placeholder ("mock") render.
- Text and template overlays are rendered from a canvas-generated PNG, so they are baked into the export **without** needing FFmpeg's `drawtext`/`libfreetype`. (If a template image is served cross-origin and taints the canvas, the export falls back to video + trim + outro without the overlay.)



## Storage Layout

```text
server/assets/defaults/   # optional local frame/outro files (gitignored — see Templates and branding)
  template.png            # optional 1080×1920 frame
  template-classic.png    # optional alternate frame
  outro.mp4               # optional default outro

storage/
  downloads/
  exports/
  renders/
  projects/
  templates/
  fonts/
  cache/
  thumbnails/
  temp/
  autosave/
  db.json
  smartforgereel.sqlite
```

## HTTP API reference

Base URL: `http://127.0.0.1:4000` (or your `PORT` / `HOST` in `server/.env`). JSON bodies unless noted. Static files: `/storage/...`, `/defaults/...`.

### Health & config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | `{ ok: true }` |
| `GET` | `/api/config` | `{ retentionHours, defaultTemplateId }` |
| `GET` | `/api/dashboard` | Project/library/export/template totals and recent items |

### Users (Settings)

| Method | Path | Body / notes |
|--------|------|----------------|
| `GET` | `/api/users` | List local users |
| `POST` | `/api/users` | `{ name, email }` — creates user with default `preferences` |
| `PATCH` | `/api/users/:id` | `{ name?, email?, preferences?: { theme?, language? } }` |
| `DELETE` | `/api/users/:id` | Remove user |

### Instagram sources & discovery

| Method | Path | Body / notes |
|--------|------|----------------|
| `GET` | `/api/accounts` | List sources |
| `POST` | `/api/accounts` | `{ handle?, mode?, urls?[] }` — handle or URLs required |
| `PATCH` | `/api/accounts/:id` | Update handle, mode, or URL list |
| `DELETE` | `/api/accounts/:id` | Delete source and its fetched videos |
| `DELETE` | `/api/accounts` | Clear all sources and fetched videos |
| `POST` | `/api/discover` | `{ accountIds?: string[], limit?: number }` — if `accountIds` omitted, fetches **all** sources; returns `{ videos, errors[] }` with the **full** fetched list after merge |
| `GET` | `/api/videos` | Fetched reels (newest first) |
| `DELETE` | `/api/videos` | Clear fetched reel list only |
| `POST` | `/api/auth/instagram-session` | Multipart `cookies` — saves Netscape cookies to `storage/cache/instagram-cookies.txt` |

### Downloads, library, uploads

| Method | Path | Body / notes |
|--------|------|----------------|
| `POST` | `/api/downloads` | `{ videoIds: string[] }` — `yt-dlp` into library |
| `POST` | `/api/uploads` | Multipart `media` — local file to library |
| `GET` | `/api/library` | Query `?q=` search, `?source=` filter |
| `GET` | `/api/assets` | Same assets as library (unsorted) |
| `PATCH` | `/api/library/:id` | Patch asset metadata |
| `DELETE` | `/api/library/:id` | Remove one asset row |
| `DELETE` | `/api/assets` | **Clear library** — all assets, downloads, files |

### Templates

| Method | Path | Body / notes |
|--------|------|----------------|
| `GET` | `/api/templates` | List templates |
| `POST` | `/api/templates` | JSON or multipart (+ optional `file`) |
| `PATCH` | `/api/templates/:id` | JSON or multipart (+ optional `file`) |
| `DELETE` | `/api/templates/:id` | Fails for built-in `default: true` templates |

### Projects & export

| Method | Path | Body / notes |
|--------|------|----------------|
| `POST` | `/api/projects` | `{ videoIds?, assetIds?, headline?, template? }` |
| `GET` | `/api/projects` | All projects (newest edit first) |
| `GET` | `/api/projects/:id` | One project |
| `PATCH` | `/api/projects/:id` | Partial project update; sets `updatedAt` (retention clock) |
| `DELETE` | `/api/projects/:id` | Delete project |
| `POST` | `/api/projects/:id/render` | Optional body: `clipId`, trim, zoom, pan, `overlayImage`, `outro`, etc. — returns job `{ id, status }` |
| `GET` | `/api/render-jobs` | Export queue |
| `GET` | `/api/export` | Alias of render jobs |
| `PATCH` | `/api/render-jobs/:id` | `{ action: "cancel" }` |
| `DELETE` | `/api/render-jobs/:id` | Remove job and rendered file |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/maintenance/reset-content` | Wipe working content; keeps accounts, users, default templates |

## Roadmap (not in this release)

- Live progress streaming for `yt-dlp` and FFmpeg jobs
- Guided Instagram login instead of manual cookie upload
- Optional PostgreSQL/Prisma backend for multi-user hosting
- Stricter TypeScript across the codebase
- Automated tests for download, upload, project, and export flows
