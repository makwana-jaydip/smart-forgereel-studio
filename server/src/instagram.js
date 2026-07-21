import https from "node:https";
import { makeId } from "./store.js";
import { scrapeAccountVideos } from "./scraper.js";

const sampleTopics = [
  "Fast tutorial hook",
  "Before and after edit",
  "Founder story cutdown",
  "Product reveal",
  "Trend remix",
  "Client testimonial",
  "Workflow shortcut",
  "Behind the scenes"
];

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

// Extracts the last unique id from an Instagram URL.
// e.g. https://www.instagram.com/p/Da2tMkDN6wa/ -> "Da2tMkDN6wa"
function normalizeShortcode(code) {
  let value = String(code || "")
    .replace(/[?#].*$/, "")
    .trim();
  value = value.replace(/_+$/g, "");
  return value || "clip";
}

export function extractReelId(url) {
  const value = String(url || "").trim();
  // /reel/CODE/, /p/CODE/, or /username/reel/CODE/ (and /username/p/CODE/)
  const match = value.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/i);
  if (match) return normalizeShortcode(match[1]);
  const parts = value.split(/[/?#]/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (/^https?:$/i.test(parts[0] || "")) {
    const shortcode = parts.find((part, i) => i > 0 && /^(p|reel|reels|tv)$/i.test(parts[i - 1]));
    if (shortcode) return normalizeShortcode(shortcode);
  }
  return normalizeShortcode(last || "clip");
}

function fetchOembedThumbnail(sourceUrl) {
  return new Promise((resolve) => {
    const url = `https://api.instagram.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
    const req = https.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 10000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(text);
          resolve(typeof json.thumbnail_url === "string" ? json.thumbnail_url : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

function fetchHtml(url, redirectLeft = 3) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, timeout: 15000 }, (res) => {
      if (redirectLeft > 0 && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        resolve(fetchHtml(next, redirectLeft - 1));
        return;
      }
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
        if (text.length > 600_000) res.destroy();
      });
      res.on("end", () => resolve(text));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
    req.on("error", () => resolve(""));
  });
}

function pickThumbnailFromEmbedHtml(html) {
  if (!html) return null;
  const srcMatches = [...html.matchAll(/src="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const cover = srcMatches.find(
    (src) =>
      /fbcdn\.net|cdninstagram\.com/i.test(src)
      && /\.(jpg|jpeg|webp)/i.test(src)
      && !/s100x100|profile_pic|rsrc\.php|static\.cdninstagram/i.test(src)
  );
  if (cover) return cover;
  const og =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i)?.[1];
  return og ? og.replace(/&amp;/g, "&") : null;
}

async function fetchEmbedThumbnail(sourceUrl) {
  const base = String(sourceUrl || "").trim().replace(/\/+$/, "").split("?")[0];
  if (!base.includes("instagram.com")) return null;
  const embedUrl = `${base}/embed/`;
  const html = await fetchHtml(embedUrl);
  return pickThumbnailFromEmbedHtml(html);
}

async function resolveManualThumbnail(sourceUrl) {
  const oembed = await fetchOembedThumbnail(sourceUrl);
  if (oembed) return oembed;
  return fetchEmbedThumbnail(sourceUrl);
}

// Returns a per-account count between 10 and 20 (deterministic per handle so
// repeated fetches are stable), honoring an explicit limit when provided.
function resolveCount(account, limit) {
  if (Number.isFinite(limit) && limit > 0) return Math.min(20, Math.max(10, Math.round(limit)));
  const seed = String(account.handle || account.id || "manual").length;
  return 10 + (seed % 11);
}

export async function discoverInstagramVideos(account, limit) {
  // Pasted reel URLs always win — even if a handle is stored on the same source.
  const urlList = (account.urls || []).filter(Boolean);
  if (urlList.length) {
    const videos = [];
    for (let index = 0; index < urlList.length; index += 1) {
      videos.push(await buildVideo(account, index, urlList[index]));
    }
    return videos;
  }

  // Live scraping of a public handle (no cookies) — the default for handle accounts.
  if (account.mode !== "mock" && account.handle && account.handle !== "manual-reels") {
    return scrapeAccountVideos(account, limit);
  }

  // Explicit mock adapter for offline/demo use.
  const count = resolveCount(account, limit);
  const videos = [];
  for (let index = 0; index < count; index += 1) {
    videos.push(await buildVideo(account, index));
  }
  return videos;
}

async function buildVideo(account, index, sourceUrl) {
  // Ordered newest first: index 0 is today, index 1 is yesterday, and so on.
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - index);
  createdAt.setHours(12, Math.max(0, 59 - index), 0, 0);

  const reelId = sourceUrl ? extractReelId(sourceUrl) : null;
  const title = sourceUrl
    ? `manual-reels-${reelId || "clip"}`
    : sampleTopics[index % sampleTopics.length];
  const handle = account.handle || "manual-reels";

  let thumbnailUrl = null;
  if (sourceUrl) {
    thumbnailUrl = await resolveManualThumbnail(sourceUrl);
  }

  return {
    id: makeId("vid"),
    accountId: account.id,
    accountHandle: handle,
    title,
    reelId,
    sourceUrl: sourceUrl || `https://www.instagram.com/reel/mock-${handle}-${index + 1}/`,
    thumbnailUrl,
    durationSec: 12 + (index % 8) * 3,
    views: 9000 + index * 2731,
    createdAt: createdAt.toISOString(),
    status: "discovered",
    localPath: null
  };
}
