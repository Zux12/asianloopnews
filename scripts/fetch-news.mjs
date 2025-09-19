// scripts/fetch-news.mjs
import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  maxRedirects: 5,
  requestOptions: {
    headers: {
      // Helps avoid some sources returning empty/blocked responses
      'User-Agent': 'Mozilla/5.0 (compatible; AsianloopNewsBot/1.0; +https://asian-loop.com)',
      'Accept': 'application/rss+xml, application/xml;q=0.9,*/*;q=0.8'
    }
  }
});


// ---- Editable knobs ----
const FRESH_DAYS = 30;            // collect up to this window (modal still uses 72h auto-show)
const MAX_ITEMS = 30;             // total items to keep
const OUT_FILE = "public/news.latest.json";

// Focused Google News queries (RSS). You can add/remove later.
const QUERIES = [
  '"custody transfer" meter',
  '"custody transfer" flow',
  '"fiscal metering"',
  '"meter proving" OR "pipe prover"',
  '"LACT unit" OR "lease automatic custody transfer"',
  '"API MPMS"',
  '"OIML R-117"',
  '"ISO 17025" metering',
  '"ultrasonic meter" custody',
  '"coriolis meter" custody',
  '"metering skid" OR "metering station" custody',
  '"LNG metering" OR "gas metering" OR "oil metering" custody'
];



// Build Google News RSS URL
// Editions to sweep (global English coverage)
const EDITIONS = [
  { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
  { hl: 'en-MY', gl: 'MY', ceid: 'MY:en' },
  { hl: 'en-AE', gl: 'AE', ceid: 'AE:en' }
];

const gnrss = (q, ed) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;

function buildFeeds() {
  const out = [];
  for (const ed of EDITIONS) {
    for (const q of QUERIES) out.push(gnrss(q, ed));
  }
  return out;
}

const feeds = buildFeeds();


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
  const t = (title || '').toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return 'Standards';
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b/.test(t)) return 'Technology';
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return 'Projects';
  if (/\bcalibration\b|\bmetrology\b|\blab\b/.test(t)) return 'Research';
  return 'Update';
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
