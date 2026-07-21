import https from "node:https";
import { makeId } from "./store.js";

// Public Instagram web app id. Required by the private-but-unauthenticated
// mobile endpoints below; no login/cookies needed for public accounts.
const IG_APP_ID = "936619743392459";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const DEFAULT_COUNT = 12;
const MAX_COUNT = 24;

function headers() {
  return {
    "x-ig-app-id": IG_APP_ID,
    "User-Agent": USER_AGENT,
    Accept: "application/json"
  };
}

// Uses node:https instead of global fetch: undici (fetch) auto-injects
// Sec-Fetch-* headers that Instagram rejects with "SecFetch Policy violation",
// and those are forbidden headers that cannot be overridden through fetch.
function fetchJson(url, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: headers(), timeout: timeoutMs }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

function firstLine(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.split("\n")[0].slice(0, 90);
}

function pickThumb(item) {
  const candidates = item?.image_versions2?.candidates;
  if (Array.isArray(candidates) && candidates.length) return candidates[0].url;
  return null;
}

function pickVideoUrl(item) {
  const versions = item?.video_versions;
  if (Array.isArray(versions) && versions.length) return versions[0].url;
  const carousel = item?.carousel_media?.find((media) => Array.isArray(media?.video_versions) && media.video_versions.length);
  return carousel?.video_versions?.[0]?.url || null;
}

function isVideoItem(item) {
  if (!item) return false;
  if (item.media_type === 2) return true;
  if (item.product_type === "clips" || item.product_type === "igtv") return true;
  if (Array.isArray(item.video_versions) && item.video_versions.length) return true;
  if (Array.isArray(item.carousel_media)) {
    return item.carousel_media.some((media) => Array.isArray(media?.video_versions) && media.video_versions.length);
  }
  return false;
}

// Maps an Instagram feed item into a SmartForgeReel video record.
function mapFeedItem(account, item) {
  const code = item.code || item.shortcode;
  const takenAt = Number(item.taken_at || item.taken_at_timestamp);
  const createdAt = Number.isFinite(takenAt) ? new Date(takenAt * 1000) : new Date();
  const durationSec = Number(item.video_duration) || 0;
  const views = Number(item.play_count ?? item.ig_play_count ?? item.view_count ?? item.like_count ?? 0);

  return {
    id: makeId("vid"),
    accountId: account.id,
    accountHandle: account.handle,
    title: firstLine(item.caption?.text) || `@${account.handle} reel`,
    reelId: code || null,
    sourceUrl: code ? `https://www.instagram.com/reel/${code}/` : null,
    videoUrl: pickVideoUrl(item),
    thumbnailUrl: pickThumb(item),
    durationSec: Number(durationSec.toFixed(2)),
    views,
    createdAt: createdAt.toISOString(),
    status: "discovered",
    localPath: null
  };
}

// Endpoint 1: mobile user feed by username. Returns items[] with direct video
// versions. Most reliable for public accounts, including many business ones.
// Paginates via next_max_id until enough VIDEO items are collected, since a
// single page can contain image/carousel posts that we skip.
async function fromUserFeed(account, wantVideos) {
  const perPage = 12;
  const maxPages = 6;
  const collected = [];
  let maxId = null;
  let sawAny = false;

  for (let page = 0; page < maxPages; page += 1) {
    const base = `https://i.instagram.com/api/v1/feed/user/${encodeURIComponent(account.handle)}/username/?count=${perPage}`;
    const url = maxId ? `${base}&max_id=${encodeURIComponent(maxId)}` : base;
    const { json } = await fetchJson(url);
    const items = json?.items;
    if (!Array.isArray(items) || !items.length) break;
    sawAny = true;
    collected.push(...items);

    const videoCount = collected.filter(isVideoItem).length;
    if (videoCount >= wantVideos) break;
    if (!json.more_available || !json.next_max_id) break;
    maxId = json.next_max_id;
  }

  return sawAny ? collected : null;
}

// Endpoint 2: web_profile_info. Returns timeline media edges. Fallback when the
// user feed is unavailable; can 500 on some business accounts (IG-side schema bug).
async function fromWebProfile(account) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(account.handle)}`;
  const { json } = await fetchJson(url);
  const edges = json?.data?.user?.edge_owner_to_timeline_media?.edges;
  if (!Array.isArray(edges) || !edges.length) return null;
  return edges.map((edge) => {
    const node = edge.node || {};
    return {
      code: node.shortcode,
      taken_at: node.taken_at_timestamp,
      media_type: node.is_video ? 2 : 1,
      product_type: node.product_type,
      video_duration: node.video_duration,
      play_count: node.video_view_count,
      like_count: node.edge_media_preview_like?.count,
      caption: { text: node.edge_media_to_caption?.edges?.[0]?.node?.text },
      image_versions2: { candidates: [{ url: node.display_url }] },
      video_versions: node.is_video && node.video_url ? [{ url: node.video_url }] : []
    };
  });
}

// Scrapes recent videos for a public Instagram account, newest first.
// No cookies required. Tries the user-feed endpoint first (with retries),
// then falls back to web_profile_info.
export async function scrapeAccountVideos(account, limit) {
  const handle = account.handle;
  if (!handle || handle === "manual-reels") {
    throw new Error("A public Instagram handle is required to fetch videos.");
  }

  const count = Math.min(MAX_COUNT, Math.max(DEFAULT_COUNT, Number(limit) || DEFAULT_COUNT));

  let items = null;
  let lastError = null;

  for (let attempt = 0; attempt < 3 && !items; attempt += 1) {
    try {
      items = await fromUserFeed(account, count);
    } catch (error) {
      lastError = error;
    }
    if (!items) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  if (!items) {
    try {
      items = await fromWebProfile(account);
    } catch (error) {
      lastError = error;
    }
  }

  if (!items) {
    throw new Error(
      `Could not fetch videos for @${handle}. Instagram may be rate-limiting this request or the account is private.${
        lastError ? ` (${lastError.message})` : ""
      }`
    );
  }

  const videos = items
    .filter(isVideoItem)
    .map((item) => mapFeedItem(account, item))
    .filter((video) => video.sourceUrl)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, count);

  if (!videos.length) {
    throw new Error(`@${handle} has no public video reels to fetch right now.`);
  }

  return videos;
}
