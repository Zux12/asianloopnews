// scripts/fetch-news.mjs
// Build a global custody-metering news JSON using Google News RSS (no API keys)

import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  maxRedirects: 5,
  requestOptions: {
    headers: {
      // Helps avoid some sources returning empty/blocked responses
      "User-Agent": "Mozilla/5.0 (compatible; AsianloopNewsBot/1.0; +https://asian-loop.com)",
      "Accept": "application/rss+xml, application/xml;q=0.9,*/*;q=0.8"
    }
  }
});

// ---- Editable knobs ----
const FRESH_DAYS = 30;            // keep up to 30 days (modal still uses 72h auto-show)
const MAX_ITEMS  = 30;            // cap total items returned
const OUT_FILE   = "public/news.latest.json";

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

// Editions to sweep (global English coverage)
const EDITIONS = [
  { hl: "en-US", gl: "US", ceid: "US:en" },
  { hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { hl: "en-SG", gl: "SG", ceid: "SG:en" },
  { hl: "en-MY", gl: "MY", ceid: "MY:en" },
  { hl: "en-AE", gl: "AE", ceid: "AE:en" }
];

const gnrss = (q, ed) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;

function buildFeeds() {
  const out = [];
  for (const ed of EDITIONS) for (const q of QUERIES) out.push(gnrss(q, ed));
  return out;
}

const feeds = buildFeeds();

// Helpers
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

// Normalize title for dedupe
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);

// Unwrap Google News redirect (?url=...) to the real article link
function normalizeLink(href) {
  try {
    const u = new URL(href);
    if (u.hostname.includes("news.google.com") && u.searchParams.has("url")) {
      return u.searchParams.get("url");
    }
  } catch (_) {}
  return href;
}

// Rough category guess (for the UI badge)
function guessCategory(title) {
  const t = (title || "").toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return "Standards";
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b/.test(t)) return "Technology";
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return "Projects";
  if (/\bcalibration\b|\bmetrology\b|\blab\b/.test(t)) return "Research";
  return "Update";
}

// ★ Keep only custody-metering domain stories; exclude finance/legal "custody"
function isCustodyMeteringRelated(title, summary) {
  const t = ((title || "") + " " + (summary || "")).toLowerCase();

  // must include a measurement keyword
  const measurement =
    /\bmeter(?:ing)?\b|\bprover\b|meter proving|pipe prover|\blact\b|lease automatic custody transfer|\bmetering (?:skid|station)\b|flow (?:meter|measurement)|ultrasonic (?:meter|measurement)|coriolis (?:meter|measurement)/;

  // must also include a custody/industry context keyword
  const context =
    /\bcustody transfer\b|\bfiscal\b|\bmpms\b|oiml|r-?117|\biso\s*17025\b|\blng\b|\boil\b|\bgas\b|\bterminal\b|\bpipeline\b/;

  // explicitly exclude false positives
  const bad =
    /\b(etf|crypto|bitcoin|token|securities|custody bank|asset management|child custody|police custody)\b/;

  return !bad.test(t) && measurement.test(t) && context.test(t);
}

// Collect and merge
async function collect() {
  const items = [];
  for (const url of feeds) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of feed.items || []) {
        const title = it.title || "";
        const rawLink = it.link || "";
        const link = normalizeLink(rawLink);
        const summary = (it.contentSnippet || it.content || "")
          .replace(/\s+/g, " ").trim();

        // Filter to custody-metering domain
        if (!isCustodyMeteringRelated(title, summary)) continue;

        items.push({
          title,
          url: link,
          sourceName: hostOf(link) || (it.creator ?? feed.title ?? "News"),
          publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
          summary: summary.slice(0, 240),
          category: guessCategory(title)
        });
      }
    } catch (e) {
      // Skip failed feed and continue
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
    let key = norm(it.title);
    try { key += "|" + new URL(it.url).pathname; } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return out;
}

async function main() {
  const raw = await collect();
  const merged = dedupeAndSort(raw)
    .filter(i => withinDays(i.publishedAt, FRESH_DAYS))
    .slice(0, MAX_ITEMS);

  const payload = { updatedAt: new Date().toISOString(), items: merged };

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
