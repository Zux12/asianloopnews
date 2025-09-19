// scripts/fetch-news.mjs
// ULTRA-SAFE: Global metering / custody-transfer / flowmeter / calibration-lab news
// via Google News RSS (no API keys). Broad but still blocks finance/legal "custody".

import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const OUT_FILE    = "public/news.latest.json";
const DEBUG_FILE  = "public/news.debug.txt";
const FRESH_DAYS  = 60;     // keep last 60 days
const MAX_ITEMS   = 30;     // cap output
const CONCURRENCY = 10;     // parallel RSS fetches

// Parser with browser-like headers
const parser = new Parser({
  timeout: 15000,
  maxRedirects: 5,
  requestOptions: {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AsianloopNewsBot/1.0; +https://asian-loop.com)",
      "Accept": "application/rss+xml, application/xml;q=0.9,*/*;q=0.8"
    }
  }
});

// English editions
const EDITIONS = [
  { hl: "en-US", gl: "US", ceid: "US:en" },
  { hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { hl: "en-SG", gl: "SG", ceid: "SG:en" },
  { hl: "en-MY", gl: "MY", ceid: "MY:en" },
  { hl: "en-AE", gl: "AE", ceid: "AE:en" },
  { hl: "en-IN", gl: "IN", ceid: "IN:en" }
];

// Broad but relevant queries (custody/fiscal/metering/flow/calibration)
const QUERIES = [
  '"custody transfer" meter',
  '"custody transfer" flow',
  '"fiscal metering"',
  '"meter proving" OR "pipe prover" OR prover',
  '"LACT unit" OR "lease automatic custody transfer"',
  '"API MPMS" OR "OIML R-117" OR "ISO 17025" metering',
  '"metering skid" OR "metering station" custody',
  '"LNG fiscal metering" OR "gas fiscal metering"',
  '"ultrasonic flowmeter" OR "ultrasonic meter"',
  '"coriolis flowmeter" OR "coriolis meter"',
  '"turbine meter" OR "orifice plate" metering',
  '"flowmeter calibration" OR "flow calibration" OR "calibration lab" metering',
  '"flow computer" OR "gas chromatograph" metering',
  '"flow meter" oil OR gas',
  '"metering system" oil OR gas'
];

const gnrss = (q, ed) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;

function buildFeeds(){
  const feeds = [];
  for (const ed of EDITIONS) for (const q of QUERIES) feeds.push(gnrss(q, ed));
  return feeds;
}
const FEEDS = buildFeeds();

// Helpers
function unwrapGoogle(href){
  try{
    const u = new URL(href);
    if (u.hostname.includes("news.google.com") && u.searchParams.has("url")) {
      return u.searchParams.get("url");
    }
  }catch(_){}
  return href;
}
function hostOf(url){ try{ return new URL(url).hostname.replace(/^www\./,''); }catch{ return ''; } }
const norm = s => (s||'').trim().toLowerCase().replace(/\s+/g,' ').slice(0,180);
function withinDays(iso, days){ return new Date(iso).getTime() >= (Date.now() - days*864e5); }

// Simple category guess (for UI chip)
function guessCategory(title){
  const t = (title||'').toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return 'Standards';
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b|\bturbine\b|\borifice\b|\bflowmeter\b|\bflow computer\b|\bgas chromatograph\b/.test(t)) return 'Technology';
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return 'Projects';
  if (/\bcalibration\b|\bmetrology\b|\blab\b|\btraceabilit(y|ies)\b/.test(t)) return 'Research';
  return 'Update';
}

// Ultra-safe relevance:
//  • keep if it mentions metering/flow/calibration terms
//  • drop obvious finance/legal "custody" noise
const RX_KEEP = /\bflow ?meter\b|\bflowmeter\b|\bmeter(?:ing|s)?\b|\bprover\b|meter proving|pipe prover|\blact\b|lease automatic custody transfer|\bmetering (?:skid|station)\b|ultrasonic (?:flow|meter|measurement)|coriolis (?:flow|meter|measurement)|turbine meter|orifice (?:plate|meter)|flow computer|gas chromatograph|calibration lab|flow calibration|metrology/;
const RX_DROP = /\b(etf|crypto|bitcoin|token|securit(?:y|ies)|custody bank|asset management|child custody|police custody|detention|crime)\b/;

function isRelevant(title, summary){
  const t = ((title||'') + ' ' + (summary||'')).toLowerCase();
  if (RX_DROP.test(t)) return false;
  return RX_KEEP.test(t);
}

// Batch parse in parallel
async function parseBatch(urls){
  const results = await Promise.all(urls.map(u => parser.parseURL(u).catch(() => null)));
  return results.filter(Boolean);
}

function itemsFromFeeds(feeds){
  const out = [];
  for (const f of feeds){
    for (const it of (f.items||[])){
      const title = it.title || '';
      const link  = unwrapGoogle(it.link || '');
      const sum   = (it.contentSnippet || it.content || '').replace(/\s+/g,' ').trim();
      if (!isRelevant(title, sum)) continue;

      out.push({
        title,
        url: link,
        sourceName: hostOf(link) || (f.title ?? 'News'),
        publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
        summary: sum.slice(0,240),
        category: guessCategory(title)
      });
    }
  }
  return out;
}

function dedupeSortCap(raw){
  const seen = new Set(), out = [];
  for (const it of raw){
    if (!it.title || !it.url) continue;
    let key = norm(it.title);
    try { key += "|" + new URL(it.url).pathname; } catch {}
    if (seen.has(key)) continue;
    seen.add(key); out.push(it);
  }
  out.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return out.slice(0, MAX_ITEMS);
}

async function main(){
  const urls = FEEDS;
  const allFeeds = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY){
    const batch = urls.slice(i, i + CONCURRENCY);
    const feeds = await parseBatch(batch);
    allFeeds.push(...feeds);
  }
  let raw = itemsFromFeeds(allFeeds).filter(i => withinDays(i.publishedAt, FRESH_DAYS));
  const items = dedupeSortCap(raw);

  const payload = {
  updatedAt: new Date().toISOString(),
  items,
  meta: { feedsTried: urls.length, kept: items.length }
};

await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");

await fs.writeFile("public/news.debug.txt",
  `${new Date().toISOString()}
feeds tried: ${payload.meta.feedsTried}
items kept: ${payload.meta.kept}
`, "utf8");


  console.log(`Wrote ${items.length} items to ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
