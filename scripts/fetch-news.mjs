// scripts/fetch-news.mjs
// Global custody-metering news JSON via Google News RSS (no API keys)

import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

// --- Output / limits ---
const OUT_FILE   = "public/news.latest.json";
const FRESH_DAYS = 30;   // keep up to 30 days in JSON
const MAX_ITEMS  = 30;   // cap total items

// --- RSS parser with a real UA (avoid empty/blocked feeds) ---
const parser = new Parser({
  timeout: 20000,
  maxRedirects: 5,
  requestOptions: {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AsianloopNewsBot/1.0; +https://asian-loop.com)",
      "Accept": "application/rss+xml, application/xml;q=0.9,*/*;q=0.8"
    }
  }
});

// --- Search space (global English editions) ---
const EDITIONS = [
  { hl: "en-US", gl: "US", ceid: "US:en" },
  { hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { hl: "en-SG", gl: "SG", ceid: "SG:en" },
  { hl: "en-MY", gl: "MY", ceid: "MY:en" },
  { hl: "en-AE", gl: "AE", ceid: "AE:en" }
];

// Focused queries (no finance/legal “custody”)
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
  '"LNG metering" OR "gas metering" OR "oil metering" custody',
  '"calibration lab" metering',
  '"flowmeter" custody OR fiscal'
];

const gnrss = (q, ed) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;

function buildFeeds() {
  const out = [];
  for (const ed of EDITIONS) for (const q of QUERIES) out.push(gnrss(q, ed));
  return out;
}
const feeds = buildFeeds();

// --- Helpers ---
function unwrapGoogle(href) {
  try {
    const u = new URL(href);
    if (u.hostname.includes("news.google.com") && u.searchParams.has("url")) {
      return u.searchParams.get("url");
    }
  } catch (_) {}
  return href;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./,""); } catch { return ""; } }
const norm = (s) => (s||"").trim().toLowerCase().replace(/\s+/g," ").slice(0,180);

function guessCategory(title) {
  const t = (title||"").toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return "Standards";
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b|\bflowmeter\b|\bmetering skid\b/.test(t)) return "Technology";
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return "Projects";
  if (/\bcalibration\b|\bmetrology\b|\blab\b/.test(t)) return "Research";
  return "Update";
}

// ★ Strict relevance filter (keeps metering domain; excludes crypto/legal custody)
function isCustodyMeteringRelated(title, summary) {
  const t = ((title||"") + " " + (summary||"")).toLowerCase();

  // must include at least one measurement keyword
  const measurement =
    /\bflow ?meter\b|\bflowmeter\b|\bmeter(?:ing)?\b|\bprover\b|meter proving|pipe prover|\blact\b|lease automatic custody transfer|\bmetering (?:skid|station)\b|ultrasonic (?:meter|measurement)|coriolis (?:meter|measurement)|calibration lab|metrology/;

  // must also include custody/industry context
  const context =
    /\bcustody transfer\b|\bfiscal\b|\bmpms\b|oiml|r-?117|\biso\s*17025\b|\blng\b|\boil\b|\bgas\b|\bterminal\b|\bpipeline\b/;

  // explicitly exclude false positives
  const bad =
    /\b(etf|crypto|bitcoin|token|securit(?:y|ies)|custody bank|asset management|child custody|police custody|detention|crime)\b/;

  return !bad.test(t) && measurement.test(t) && context.test(t);
}

// --- Fetch + collect ---
async function collect() {
  const all = [];
  for (const url of feeds) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of (feed.items||[])) {
        const rawLink = it.link || "";
        const link    = unwrapGoogle(rawLink);
        const title   = it.title || "";
        const sum     = (it.contentSnippet || it.content || "").replace(/\s+/g," ").trim();

        if (!isCustodyMeteringRelated(title, sum)) continue;

        all.push({
          title,
          url: link,
          sourceName: hostOf(link) || (feed.title ?? "News"),
          publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
          summary: sum.slice(0, 240),
          category: guessCategory(title)
        });
      }
    } catch (e) {
      console.error("Feed error:", url, e.message);
    }
  }
  return all;
}

function withinDays(iso, days) {
  const t = new Date(iso).getTime();
  const cutoff = Date.now() - days*24*60*60*1000;
  return t >= cutoff;
}
function dedupeAndSort(raw) {
  const seen = new Set(); const out = [];
  for (const it of raw) {
    if (!it.title || !it.url) continue;
    let key = norm(it.title);
    try { key += "|" + new URL(it.url).pathname; } catch {}
    if (seen.has(key)) continue;
    seen.add(key); out.push(it);
  }
  out.sort((a,b)=> new Date(b.publishedAt) - new Date(a.publishedAt));
  return out;
}

async function main() {
  const raw    = await collect();
  const merged = dedupeAndSort(raw).filter(i=> withinDays(i.publishedAt, FRESH_DAYS)).slice(0, MAX_ITEMS);

  const payload = { updatedAt: new Date().toISOString(), items: merged };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${merged.length} items to ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
