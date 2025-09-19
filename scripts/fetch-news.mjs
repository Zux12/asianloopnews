// scripts/fetch-news.mjs
// CURATED-ONLY fallback: always yields metering/flow/calibration items (no API keys)

import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";

const OUT_FILE   = "public/news.latest.json";
const DEBUG_FILE = "public/news.debug.txt";
const MAX_ITEMS  = 30;
const CONCURRENCY = 8;

const CURATED_RSS = [
  // Trade / industry (reliable)
  "https://www.lngindustry.com/rss/",
  "https://www.hydrocarbonengineering.com/rss/",
  "https://www.pipeline-journal.net/rss.xml",
  // Vendor / instrumentation blogs (general measurement; we’ll filter)
  "https://www.emersonautomationexperts.com/feed/",
  "https://blog.krohne.com/feed/",
  "https://press.siemens.com/global/en/rss"
];

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

function hostOf(url){ try{ return new URL(url).hostname.replace(/^www\./,''); } catch { return ""; } }
const norm = s => (s||"").trim().toLowerCase().replace(/\s+/g," ").slice(0,180);

const RX_KEEP = /\b(custody transfer|fiscal|mpms|oiml|r-?117|iso\s*17025|meter(?:ing|s)?|flow ?meter|flowmeter|prover|meter proving|pipe prover|lact|lease automatic custody transfer|metering (?:skid|station)|ultrasonic|coriolis|turbine meter|orifice (?:plate|meter)|flow computer|gas chromatograph|calibration|metrology)\b/i;
const RX_DROP = /\b(etf|crypto|bitcoin|token|securit(?:y|ies)|custody bank|asset management|child custody|police custody|detention|crime)\b/i;
const RX_UTILITY = /\b(electric|electricity|power|smart|water)\s+meter(s)?\b/i; // de-rank

function relevanceScore(title, summary){
  const t = ((title||"") + " " + (summary||"")).toLowerCase();
  if (RX_DROP.test(t)) return -9999;
  if (!RX_KEEP.test(t)) return -999;
  let s = 1;
  if (RX_UTILITY.test(t)) s -= 2;
  if (/custody transfer|fiscal|mpms|oiml|iso\s*17025/i.test(t)) s += 4;
  if (/prover|meter proving|lact/i.test(t)) s += 2;
  if (/ultrasonic|coriolis|turbine|orifice|flow computer|gas chromatograph/i.test(t)) s += 1;
  return s;
}

async function parseBatch(urls){
  const res = await Promise.all(urls.map(u => parser.parseURL(u).catch(() => null)));
  return res.filter(Boolean);
}

function itemsFromFeeds(feeds){
  const out = [];
  for (const f of feeds){
    for (const it of (f.items||[])){
      const title = it.title || "";
      const link  = it.link  || "";
      const sum   = (it.contentSnippet || it.content || "").replace(/\s+/g," ").trim();
      const score = relevanceScore(title, sum);
      if (score < 0) continue;
      out.push({
        title,
        url: link,
        sourceName: hostOf(link) || (f.title ?? "News"),
        publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
        summary: sum.slice(0,240),
        category: guessCategory(title),
        _score: score
      });
    }
  }
  return out;
}

function guessCategory(title){
  const t = (title||"").toLowerCase();
  if (/\bmpms\b|\boiml\b|r-117|\biso\s*17025\b/.test(t)) return "Standards";
  if (/\bprover\b|\blact\b|\bultrasonic\b|\bcoriolis\b|\bturbine\b|\borifice\b|\bflowmeter\b|\bflow computer\b|\bgas chromatograph\b/.test(t)) return "Technology";
  if (/\bcontract\b|\bawarded\b|\bterminal\b|\bproject\b|\btender\b/.test(t)) return "Projects";
  if (/\bcalibration\b|\bmetrology\b|\blab\b/.test(t)) return "Research";
  return "Update";
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

async function readPreviousItems(){
  try{
    const buf = await fs.readFile(OUT_FILE, "utf8");
    const json = JSON.parse(buf);
    return Array.isArray(json.items) ? json.items : [];
  }catch{ return []; }
}

async function main(){
  // 1) fetch curated feeds in parallel
  const feeds = [];
  for (let i=0; i<CURATED_RSS.length; i+=CONCURRENCY){
    const batch = CURATED_RSS.slice(i, i+CONCURRENCY);
    const got = await parseBatch(batch);
    feeds.push(...got);
  }
  let raw = itemsFromFeeds(feeds);
  let items = dedupeSortCap(raw);

  // 2) never overwrite with empty: keep previous non-empty list
  if (items.length === 0){
    const prev = await readPreviousItems();
    if (prev.length) items = prev;
  }

  // 3) write outputs
  const payload = {
    updatedAt: new Date().toISOString(),
    items,
    meta: { feedsTried: CURATED_RSS.length, kept: items.length }
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(DEBUG_FILE,
    `${new Date().toISOString()}
feeds tried: ${payload.meta.feedsTried}
items kept: ${payload.meta.kept}
`, "utf8");

  console.log(`Wrote ${items.length} items to ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
