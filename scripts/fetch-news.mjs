// scripts/fetch-news.mjs
import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000, // 20s
  maxRedirects: 5
});

// ---- Editable knobs ----
const FRESH_DAYS = 10;            // collect up to this window (modal still uses 72h auto-show)
const MAX_ITEMS = 12;             // total items to keep
const OUT_FILE = "public/news.latest.json";

// Focused Google News queries (RSS). You can add/remove later.
const QUERIES = [
  'custody transfer metering',
  'meter proving OR "pipe prover"',
  '"API MPMS" 21.1',
  '"OIML R-117"',
  '"ISO 17025" calibration metering',
  '"LACT unit" custody'
];

// Build Google News RSS URL
const gnrss = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

const feeds = QUERIES.map(gnrss);

// Helper: domain from URL
function hostOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return ""; }
}

// Helper: normalize title for dedupe
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);

// Category guess (very rough)
function guessCategory(title) {
  const t = title.toLowerCase();
  if (t.includes("mpms") || t.includes("oiml") || t.includes("r-117") || t.includes("iso 17025")) return "Standards";
  if (t.includes("prover") || t.includes("lact") || t.includes("ultrasonic") || t.includes("coriolis")) return "Technology";
  if (t.includes("contract") || t.includes("awarded") || t.includes("terminal") || t.includes("project")) return "Projects";
  return "Update";
}

// Collect and merge
async function collect() {
  const items = [];
  for (const url of feeds) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of feed.items || []) {
        items.push({
          title: it.title || "",
          url: it.link || "",
          sourceName: hostOf(it.link || "") || (it.creator ?? feed.title ?? "News"),
          publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
          summary: (it.contentSnippet || it.content || "").replace(/\s+/g, " ").trim().slice(0, 240),
          category: guessCategory(it.title || "")
        });
      }
    } catch (e) {
      // Skip failed feed
      console.error("Feed error:", url, e.message);
    }
  }
  return items;
}

function withinDays(iso, days) {
  const t = new Date(iso).getTime();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

function dedupeAndSort(raw) {
  const seen = new Set();
  const out = [];
  for (const it of raw) {
    if (!it.title || !it.url) continue;
    const key = norm(it.title) + "|" + new URL(it.url).pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return out;
}

async function main() {
  const raw = await collect();
  const merged = dedupeAndSort(raw).filter(i => withinDays(i.publishedAt, FRESH_DAYS)).slice(0, MAX_ITEMS);
  const payload = {
    updatedAt: new Date().toISOString(),
    items: merged
  };

  // Ensure output folder exists
  const dir = path.dirname(OUT_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${merged.length} items to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
