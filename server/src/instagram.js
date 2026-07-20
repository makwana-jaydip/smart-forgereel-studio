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

// Extracts the last unique id from an Instagram URL.
// e.g. https://www.instagram.com/p/Da2tMkDN6wa/ -> "Da2tMkDN6wa"
export function extractReelId(url) {
  const value = String(url || "");
  const match = value.match(/instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
  if (match) return match[1];
  const parts = value.split(/[/?#]/).filter(Boolean);
  return parts[parts.length - 1] || "clip";
}

// Returns a per-account count between 10 and 20 (deterministic per handle so
// repeated fetches are stable), honoring an explicit limit when provided.
function resolveCount(account, limit) {
  if (Number.isFinite(limit) && limit > 0) return Math.min(20, Math.max(10, Math.round(limit)));
  const seed = String(account.handle || account.id || "manual").length;
  return 10 + (seed % 11);
}

export async function discoverInstagramVideos(account, limit) {
  // Pasted reel URLs: build directly from what the user provided.
  if (account.mode === "urls" && account.urls?.length) {
    return account.urls.map((url, index) => buildVideo(account, index, url));
  }

  // Live scraping of a public handle (no cookies) — the default for handle accounts.
  if (account.mode !== "mock" && account.handle && account.handle !== "manual-reels") {
    return scrapeAccountVideos(account, limit);
  }

  // Explicit mock adapter for offline/demo use.
  const count = resolveCount(account, limit);
  return Array.from({ length: count }, (_, index) => buildVideo(account, index));
}

function buildVideo(account, index, sourceUrl) {
  // Ordered newest first: index 0 is today, index 1 is yesterday, and so on.
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - index);
  createdAt.setHours(12, Math.max(0, 59 - index), 0, 0);

  const reelId = sourceUrl ? extractReelId(sourceUrl) : null;
  const title = reelId ? `manual-reels-${reelId}` : sampleTopics[index % sampleTopics.length];
  const handle = account.handle || "manual-reels";

  return {
    id: makeId("vid"),
    accountId: account.id,
    accountHandle: handle,
    title,
    reelId,
    sourceUrl: sourceUrl || `https://www.instagram.com/reel/mock-${handle}-${index + 1}/`,
    thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent(handle)}-${index}/640/960`,
    durationSec: 12 + (index % 8) * 3,
    views: 9000 + index * 2731,
    createdAt: createdAt.toISOString(),
    status: "discovered",
    localPath: null
  };
}
