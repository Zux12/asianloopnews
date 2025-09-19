// scripts/fetch-news.mjs
// SAFE-MODE: Global metering / custody-transfer / flowmeter / calibration-lab news
// via Google News RSS only (no API keys). Looser scoring + fallback so it never ends empty.

import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const OUT_FILE     = "public/news.latest.json";
const DEBUG_FILE   = "public/news.debug.txt"; // quick sanity log
const FRESH_DAYS   = 45;     // keep last 45 days
const MAX_ITEMS    = 30;     // output cap
const CONCURRENCY  = 10;     // parallel RSS fetches
const MIN_SCORE    = 0;      // <<< keep items with score >= 0 (safe mode)

// RSS parser with a real UA (avoids empty/blocked responses)
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

// English editions to sweep (broad coverage)
const EDITIONS = [
  { hl: "en-US", gl: "US", ceid: "US:en" },
  { hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { hl: "en-SG", gl: "SG", ceid: "SG:en" },
  { hl: "en-MY", gl: "MY", ceid: "MY:en" },
  { hl: "en-AE", gl: "AE", ceid: "AE:en" },
  { hl: "en-IN", gl: "IN", ceid: "IN:en" }
];

// Core custody/fiscal/metering queries
const Q_CORE = [
  '"custody transfer" meter',
  '"custody transfer" flow',
  '"fiscal metering"',
  '"meter proving" OR "pipe prover"',
  '"LACT unit" OR "lease automatic custody transfer"',
  '"API MPMS"',
  '"OIML R-117"',
  '"ISO 17025" metering',
  '"metering skid" OR "metering station" custody',
  '"LNG fiscal metering" OR "gas fiscal metering"'
];

// Wider metering/flow/calibration domain
const Q_WIDE = [
  '"ultrasonic flowmeter" OR "ultrasonic meter"',
  '"coriolis flowmeter" OR "coriolis meter"',
  '"turbine meter" OR "orifice plate" metering',
  '"flowmeter calibration" OR "flow calibration"',
  '"calibration lab" metering OR flow',
  '"metrology" flow OR metering',
  '"flow computer" OR "gas chromatograph" metering',
  '"flow meter" oil OR gas',
  '"metering system" oil OR gas'
];

// Targeted vendor/industry sites (still via Google News, but scoped)
const Q_SITES = [
  'site:emerson.com flowmeter OR custody',
  'site:endress.com flowmeter OR custody OR calibration',
  'site:krohne.com flowmeter OR custody OR calibration',
  'site:yokogawa.com flowmeter OR custody',
  'site:abb.com flow measurement OR custody',
  'site:honeywell.com flowmeter OR custody',
  'site:siemens.com flowmeter OR custody',
  'site:lngindustry.com metering OR flowmeter',
  'site:worldoil.com metering OR flow',
  'site:offshore-technology.com metering OR flowmeter'
];


// Emergency fallback (very broad, still filtered)
const Q_FALLBACK = [
  'flowmeter',
  '"metering skid"',
  '"flow calibration"',
  '"flow measurement" oil OR gas'
];

const gnrss = (q, ed) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;

function feedsOf(queries){
  const out = [];
  for (const ed of EDITIONS) for (const q of queries) out.push(gnrss(q, ed));
  return out;
}

const FEEDS_CORE     = feedsOf(Q_CORE);
const FEEDS_WIDE     = feedsOf(Q_WIDE);
const FEEDS_SITES    = feedsOf(Q_SITES);
const FEEDS_FALLBACK = feedsOf(Q_FALLBACK);


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

function guessCategory(title){
  const t = (title||'').toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return 'Standards';
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b|\bturbine\b|\borifice\b|\bflowmeter\b|\bflow computer\b|\bgas chromatograph\b/.test(t)) return 'Technology';
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return 'Projects';
  if (/\bcalibration\b|\bmetrology\b|\blab\b|\btraceabilit(y|ies)\b/.test(t)) return 'Research';
  return 'Update';
}

// Relevance scoring (SOFT) — keep domain, exclude noise
const RX_MEAS  = /\bflow ?meter\b|\bflowmeter\b|\bmeter(?:ing|s)?\b|\bprover\b|meter proving|pipe prover|\blact\b|lease automatic custody transfer|\bmetering (?:skid|station)\b|ultrasonic (?:flow|meter|measurement)|coriolis (?:flow|meter|measurement)|turbine meter|orifice (?:plate|meter)|flow computer|gas chromatograph|calibration lab|metrology/;
// Avoid utility/electric/water-only consumer meters (not our domain)
const RX_BAD_UTILITY = /\b(electric|electricity|power|smart|water)\s+meter(s)?\b/;
// Context boosts help ranking but are NOT strictly required in safe-mode
const RX_CTX_STRONG = /\bcustody transfer\b|\bfiscal\b|\bmpms\b|oiml|r-?117|\biso\s*17025\b/;
const RX_CTX_WEAK   = /\blng\b|\boil\b|\bgas\b|\bterminal\b|\bpipeline\b|\bproving\b|\bcalibration\b|\btraceabilit(y|ies)\b|\buncertainty\b/;
// Exclude finance/legal “custody”
const RX_BAD        = /\b(etf|crypto|bitcoin|token|securit(?:y|ies)|custody bank|asset management|child custody|police custody|detention|crime)\b/;

function scoreText(title, summary){
  const t = ((title||'') + ' ' + (summary||'')).toLowerCase();

  if (!RX_MEAS.test(t))         return -999;   // out of domain
  if (RX_BAD.test(t))           return -9999;  // finance/legal custody
  if (RX_BAD_UTILITY.test(t))   return -50;    // de-rank utility meters

  let s = 0;
  if (RX_CTX_STRONG.test(t)) s += 6;
  if (RX_CTX_WEAK.test(t))   s += 3;
  if (/custody transfer/.test(t)) s += 2;
  if (/meter proving|pipe prover|lact/.test(t)) s += 2;
  if (/ultrasonic|coriolis|turbine|orifice|flow computer|gas chromatograph/.test(t)) s += 1;

  return s;
}

// Parse a batch of RSS URLs in parallel
async function parseBatch(urls){
  const results = await Promise.all(urls.map(u => parser.parseURL(u).catch(() => null)));
  return results.filter(Boolean);
}

// Convert feeds -> items with scoring
function itemsFromFeeds(feeds){
  const out = [];
  for (const f of feeds){
    for (const it of (f.items||[])){
      const title = it.title || '';
      const link  = unwrapGoogle(it.link || '');
      const sum   = (it.contentSnippet || it.content || '').replace(/\s+/g,' ').trim();
      const score = scoreText(title, sum);
      if (score < MIN_SCORE) continue;

      out.push({
        title,
        url: link,
        sourceName: hostOf(link) || (f.title ?? 'News'),
        publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
        summary: sum.slice(0,240),
        category: guessCategory(title),
        _score: score
      });
    }
  }
  return out;
}

async function collectAll(){
  let debug = [];

  const allFeeds = [];
const urls1 = [...FEEDS_CORE, ...FEEDS_WIDE, ...FEEDS_SITES];

  for (let i = 0; i < urls1.length; i += CONCURRENCY){
    const batch = urls1.slice(i, i + CONCURRENCY);
    const feeds = await parseBatch(batch);
    allFeeds.push(...feeds);
  }
  let items = itemsFromFeeds(allFeeds).filter(i => withinDays(i.publishedAt, FRESH_DAYS));
  debug.push(`Core+Wide feeds: ${allFeeds.length}, items kept: ${items.length}`);

  // Fallback sweep if still light
  if (items.length < 10){
    const allFb = [];
    for (let i = 0; i < FEEDS_FALLBACK.length; i += CONCURRENCY){
      const feeds = await parseBatch(FEEDS_FALLBACK.slice(i, i + CONCURRENCY));
      allFb.push(...feeds);
    }
    const fbItems = itemsFromFeeds(allFb).filter(i => withinDays(i.publishedAt, FRESH_DAYS));
    debug.push(`Fallback feeds: ${allFb.length}, items kept: ${fbItems.length}`);
    items.push(...fbItems);
  }

  return { items, debug };
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
  out.sort((a,b) => (b._score - a._score) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return out.slice(0, MAX_ITEMS).map(({_score, ...rest}) => rest);
}

async function main(){
  const { items: raw, debug } = await collectAll();
  const items = dedupeSortCap(raw);

  const payload = { updatedAt: new Date().toISOString(), items };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");

  // Write a tiny debug note so you can see if we had content but then filtered to 0
  await fs.writeFile(DEBUG_FILE, `${new Date().toISOString()}\n${debug.join("\n")}\nFinal items: ${items.length}\n`, "utf8");

  console.log(`Wrote ${items.length} items to ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
