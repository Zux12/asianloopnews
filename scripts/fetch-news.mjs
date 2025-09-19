// scripts/fetch-news.mjs
// Global metering / custody-transfer / flowmeter / calibration-lab news via Google News RSS (no API keys)

import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const OUT_FILE   = "public/news.latest.json";
const FRESH_DAYS = 30;     // keep last 30 days in JSON
const MAX_ITEMS  = 30;     // cap output
const CONCURRENCY = 8;     // parallel RSS fetches

// RSS parser with a real UA (avoids silent empty/blocked responses)
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

// English editions to sweep (broad but readable)
const EDITIONS = [
  { hl: "en-US", gl: "US", ceid: "US:en" },
  { hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { hl: "en-SG", gl: "SG", ceid: "SG:en" },
  { hl: "en-MY", gl: "MY", ceid: "MY:en" },
  { hl: "en-AE", gl: "AE", ceid: "AE:en" }
];

// Focus: custody transfer + metering + flowmeters + calibration labs
// Primary terms (more likely to be on-topic for oil/gas custody/fiscal)
const QUERIES_PRIMARY = [
  '"custody transfer" meter',
  '"custody transfer" flow',
  '"fiscal metering"',
  '"meter proving" OR "pipe prover"',
  '"LACT unit" OR "lease automatic custody transfer"',
  '"API MPMS"',
  '"OIML R-117"',
  '"ISO 17025" metering',
  '"metering skid" OR "metering station" custody',
  '"LNG metering" OR "gas fiscal metering"'
];

// Secondary terms (wider metering/flow/calibration domain)
const QUERIES_SECONDARY = [
  '"ultrasonic flowmeter" OR "ultrasonic meter"',
  '"coriolis flowmeter" OR "coriolis meter"',
  '"turbine meter" OR "orifice plate" metering',
  '"calibration lab" metering OR flow',
  '"flowmeter calibration" OR "flow calibration"',
  '"metrology" flow OR metering'
];

const gnrss = (q, ed) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`;

function buildFeeds(){
  const feeds = [];
  for (const ed of EDITIONS){
    for (const q of QUERIES_PRIMARY)   feeds.push(gnrss(q, ed));
    for (const q of QUERIES_SECONDARY) feeds.push(gnrss(q, ed));
  }
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

// Relevance model (scores instead of a hard filter)
const RX_MEAS = /\bflow ?meter\b|\bflowmeter\b|\bmeter(?:ing|s)?\b|\bprover\b|meter proving|pipe prover|\blact\b|lease automatic custody transfer|\bmetering (?:skid|station)\b|ultrasonic (?:flow|meter|measurement)|coriolis (?:flow|meter|measurement)|turbine meter|orifice (?:plate|meter)|flow computer|gas chromatograph|calibration lab|metrology/;
const RX_CTX_STRONG = /\bcustody transfer\b|\bfiscal\b|\bmpms\b|oiml|r-?117|\biso\s*17025\b/;
const RX_CTX_WEAK   = /\blng\b|\boil\b|\bgas\b|\bterminal\b|\bpipeline\b|\bproving\b|\bcalibration\b|\btraceability\b|\buncertainty\b/;
const RX_BAD        = /\b(etf|crypto|bitcoin|token|securit(?:y|ies)|custody bank|asset management|child custody|police custody|detention|crime)\b/;

function scoreText(title, summary){
  const t = ((title||'') + ' ' + (summary||'')).toLowerCase();

  if (!RX_MEAS.test(t)) return -999;      // not metering/flow/calibration → drop
  if (RX_BAD.test(t))  return -9999;      // finance/legal “custody” → drop

  let s = 0;
  if (RX_CTX_STRONG.test(t)) s += 6;      // MPMS/OIML/ISO17025/custody/fiscal
  if (RX_CTX_WEAK.test(t))   s += 3;      // LNG/oil/gas/pipeline/proving/calibration
  if (/custody transfer/.test(t)) s += 3; // double weight if explicit
  if (/meter proving|pipe prover|lact/.test(t)) s += 2;
  if (/ultrasonic|coriolis|turbine|orifice|flow computer|gas chromatograph/.test(t)) s += 1;
  return s;
}

function withinDays(iso, days){
  const t = new Date(iso).getTime();
  return t >= (Date.now() - days*864e5);
}

// Parallel feed fetcher (batched)
async function collect(){
  const urls = FEEDS.slice();
  const out = [];

  const toItem = (feed, it) => {
    const title = it.title || '';
    const link  = unwrapGoogle(it.link || '');
    const sum   = (it.contentSnippet || it.content || '').replace(/\s+/g,' ').trim();
    const score = scoreText(title, sum);
    if (score < 0) return null;

    return {
      title,
      url: link,
      sourceName: hostOf(link) || (feed.title ?? 'News'),
      publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
      summary: sum.slice(0,240),
      category: guessCategory(title),
      _score: score
    };
  };

  for (let i = 0; i < urls.length; i += CONCURRENCY){
    const batch = urls.slice(i, i + CONCURRENCY);
    const feeds = await Promise.all(batch.map(u => parser.parseURL(u).catch(() => null)));
    for (const f of feeds){
      if (!f || !f.items) continue;
      for (const it of f.items){
        const item = toItem(f, it);
        if (item) out.push(item);
      }
    }
  }
  return out;
}

function guessCategory(title){
  const t = (title||'').toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return 'Standards';
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b|\bturbine\b|\borifice\b|\bflowmeter\b/.test(t)) return 'Technology';
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return 'Projects';
  if (/\bcalibration\b|\bmetrology\b|\blab\b/.test(t)) return 'Research';
  return 'Update';
}

function dedupeSortCap(raw){
  const seen = new Set();
  const out = [];
  for (const it of raw){
    if (!it.title || !it.url) continue;
    let key = norm(it.title);
    try { key += '|' + new URL(it.url).pathname; } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a,b) => (b._score - a._score) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return out.slice(0, MAX_ITEMS).map(({_score, ...rest}) => rest);
}

async function main(){
  const raw = await collect();
  const filtered = raw.filter(i => withinDays(i.publishedAt, FRESH_DAYS));
  const items = dedupeSortCap(filtered);

  const payload = { updatedAt: new Date().toISOString(), items };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${items.length} items to ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
