#!/usr/bin/env node
// pipeline.js — Single streaming pipeline for Elections Notebook
// Usage:
//   Pass 1 (data collection): node pipeline.js --candidates <path> --notebook <path> --output <path> --data <path> [--pause-for-flags]
//   Pass 2 (docx update only): node pipeline.js --notebook <path> --output <path> --data <path> --resume
//   Review flags:              node pipeline.js --data <path> --review-flags
//   Apply single flag:         node pipeline.js --data <path> --apply-flag <index> --action confirm|reject
//   Apply batch flags:         node pipeline.js --data <path> --apply-flags <decisions.json>
//   Verify output:             node pipeline.js --data <path> --verify <output.docx> [--count 5]
//
// Self-contained — all logic inline.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { execFileSync } = require('child_process');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const CYCLE_YEAR = config.election_cycle_year || 2026;
const POOL_SIZE = config.extraction_concurrency || 10;
const BATCH_DELAY = 50;
const PARTY_COLORS = config.party_colors;
const FLAG_CACHE_FILE = config.flag_cache_file || path.join(config.notebook_dir, 'Pipeline Data', 'flag_decisions_cache.json');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ===========================================================================
// Flag Decision Cache
// ===========================================================================
function loadFlagCache() {
  try {
    if (fs.existsSync(FLAG_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(FLAG_CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.log(`  WARN: Could not load flag cache: ${e.message}`);
  }
  return {};
}

function saveFlagCache(cache) {
  const dir = path.dirname(FLAG_CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FLAG_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function flagCacheKey(flag) {
  switch (flag.type) {
    case 'fuzzy_incumbent_match':
      return `${flag.candidate_name}|${flag.roster_name}`;
    case 'fuzzy_entity_match':
      return `${flag.candidate_name}|${flag.potential_entity_name}`;
    case 'suspended_nonincumbent':
      return flag.candidate_name;
    case 'multiple_active':
      return `${flag.candidate_name}|D${flag.district}|${flag.chamber}`;
    default:
      return null;
  }
}

function applyCachedDecisions(flags, data) {
  const cache = loadFlagCache();
  let applied = 0;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    const key = flagCacheKey(flag);
    if (!key) continue;
    const bucket = cache[flag.type];
    if (!bucket || !(key in bucket)) continue;
    const decision = bucket[key];

    if (flag.type === 'multiple_active') {
      if (typeof decision === 'number') {
        flag.chosen_entity_id = decision;
        flag._cached = true;
        applied++;
      }
    } else if (flag.type === 'fuzzy_incumbent_match') {
      if (decision === 'confirm') { flag.confirmed = true; delete flag.rejected; }
      else { flag.rejected = true; delete flag.confirmed; }
      flag._cached = true;
      applied++;
    } else if (flag.type === 'fuzzy_entity_match') {
      if (decision === 'confirm') { flag.confirmed = true; delete flag.rejected; }
      else { flag.rejected = true; delete flag.confirmed; }
      flag._cached = true;
      applied++;
    } else if (flag.type === 'suspended_nonincumbent') {
      flag.approved = decision === 'keep' || decision === 'confirm';
      flag._cached = true;
      applied++;
    }
  }
  return applied;
}

function updateFlagCache(flags) {
  const cache = loadFlagCache();
  for (const flag of flags) {
    const key = flagCacheKey(flag);
    if (!key) continue;
    if (!cache[flag.type]) cache[flag.type] = {};

    if (flag._cached) continue;
    if (flag.type === 'multiple_active' && flag.chosen_entity_id) {
      cache[flag.type][key] = flag.chosen_entity_id;
    } else if (flag.type === 'fuzzy_incumbent_match' && (flag.confirmed || flag.rejected)) {
      cache[flag.type][key] = flag.confirmed ? 'confirm' : 'reject';
    } else if (flag.type === 'fuzzy_entity_match' && (flag.confirmed || flag.rejected)) {
      cache[flag.type][key] = flag.confirmed ? 'confirm' : 'reject';
    } else if (flag.type === 'suspended_nonincumbent' && flag.approved !== undefined) {
      cache[flag.type][key] = flag.approved ? 'keep' : 'remove';
    }
  }
  saveFlagCache(cache);
  return cache;
}

// ===========================================================================
// CLI
// ===========================================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pause-for-flags') { opts.pauseForFlags = true; continue; }
    if (args[i] === '--resume') { opts.resume = true; continue; }
    if (args[i] === '--review-flags') { opts.reviewFlags = true; continue; }
    if (args[i] === '--verify') { opts.verify = true; continue; }
    // --apply-flag <index> (single flag mode, requires --action)
    if (args[i] === '--apply-flag' && args[i + 1]) { opts.applyFlag = parseInt(args[++i], 10); continue; }
    // --apply-flags <decisions.json> (batch mode)
    if (args[i] === '--apply-flags' && args[i + 1]) { opts.applyFlags = args[++i]; continue; }
    if (args[i].startsWith('--') && args[i + 1]) {
      opts[args[i].slice(2)] = args[++i];
    }
  }
  // Determine mode and validate required args
  const isUtilityMode = opts.reviewFlags || opts.applyFlags !== undefined || opts.applyFlag !== undefined || opts.verify;
  if (!opts.data) { console.error('Missing --data'); process.exit(1); }
  if (!isUtilityMode) {
    if (!opts.notebook) { console.error('Missing --notebook'); process.exit(1); }
    if (!opts.output) { console.error('Missing --output'); process.exit(1); }
    if (!opts.resume && !opts.candidates) { console.error('Missing --candidates (required unless --resume)'); process.exit(1); }
  }
  if (opts.verify) {
    // --verify needs a docx path as the next positional after --data <file> --verify
    // We stored it: the user passes --verify <output.docx> but we consumed it as boolean
    // Re-parse: find --verify and grab next arg
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--verify' && args[i + 1] && !args[i + 1].startsWith('--')) {
        opts.verifyDocx = args[i + 1]; break;
      }
    }
    if (!opts.verifyDocx) { console.error('Missing docx path after --verify'); process.exit(1); }
  }
  if (opts.applyFlag !== undefined && !opts.action) {
    console.error('--apply-flag requires --action confirm|reject'); process.exit(1);
  }
  return opts;
}

// ===========================================================================
// Utility Helpers
// ===========================================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const startTime = Date.now();
function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1) + 's'; }

async function batchParallel(items, batchSize, delayMs, fn) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, j) => fn(item, i + j, items.length))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': USER_AGENT, ...(opts.headers || {}) };
    mod.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) {
          const parsed = new URL(url);
          loc = `${parsed.protocol}//${parsed.host}${loc}`;
        }
        res.resume();
        httpGet(loc, opts).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpPost(url, body, contentType) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGetBinary(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpGetBinary(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * THE single name normalization function used everywhere:
 * API matching, incumbent detection, docx row matching.
 * Hyphens are converted to spaces to ensure consistent matching.
 */
function normalizeName(raw) {
  let name = (raw || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (name.includes(',')) {
    const [last, first] = name.split(',').map(s => s.trim());
    name = `${(first || '').trim()} ${last.trim()}`.trim();
  }
  // Strip quotes, periods, nicknames in quotes, and parenthetical suffixes uniformly
  name = name.replace(/["'.]/g, '').replace(/\(.*?\)/g, '').trim();
  name = name.replace(/\b(jr\.?|sr\.?|ii|iii|iv)\s*$/i, '').trim();
  name = name.replace(/-/g, ' ');
  name = name.replace(/\s+/g, ' ');
  const parts = name.split(' ');
  const first = parts[0] || '';
  const filtered = parts.filter((p, i) => i === 0 || i === parts.length - 1 || p.length > 1);
  const last = filtered[filtered.length - 1] || '';
  return { full: filtered.join(' '), last, firstInitial: first.charAt(0), first, raw: (raw || '').trim() };
}

function cleanEntityName(raw) {
  if (!raw) return '';
  return raw.replace(/<[^>]+>/g, '').replace(/\(\d+\)\s*$/, '').trim();
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
}

function parseOfficeName(officeName) {
  if (!officeName) return { chamber: null, district: null };
  const str = officeName.toLowerCase();
  let chamber = null;
  if (/representative|house/i.test(str)) chamber = 'house';
  else if (/senator|senate/i.test(str)) chamber = 'senate';
  const distMatch = str.match(/(\d+)/);
  const district = distMatch ? parseInt(distMatch[1], 10) : null;
  return { chamber, district };
}

// Derive financing from EntityTypeName (returned by the search API)
function deriveFinancing(entityTypeName) {
  if (!entityTypeName) return '-';
  if (/not participating/i.test(entityTypeName)) return 'Private';
  if (/participating in clean elections/i.test(entityTypeName)) return 'Public';
  if (/candidate/i.test(entityTypeName)) return 'Private';
  return '-';
}

// ===========================================================================
// Phase A: Bulk Setup
// ===========================================================================

function parseCandidates(rawCandidates) {
  if (!Array.isArray(rawCandidates) && rawCandidates && Array.isArray(rawCandidates.candidates)) {
    rawCandidates = rawCandidates.candidates;
  }
  if (!Array.isArray(rawCandidates)) {
    throw new Error(`Expected candidates array, got ${typeof rawCandidates}`);
  }
  const candidates = rawCandidates.map((c) => {
    let chamber = null;
    if (/representative/i.test(c.office)) chamber = 'house';
    else if (/senator/i.test(c.office) || /senate/i.test(c.office)) chamber = 'senate';
    const distMatch = c.office.match(/district\s*(?:no\.?\s*)?(\d+)/i);
    const district = distMatch ? parseInt(distMatch[1], 10) : null;
    return { name: c.name.trim(), party: c.party, chamber, district, suspended: false, filedDate: c.filedDate || null, office: c.office };
  });

  const valid = candidates.filter(c => c.chamber && c.district);
  const deduped = [];
  const seen = new Map();
  for (const c of valid) {
    const key = `${c.name.toLowerCase()}|${c.district}|${c.chamber}`;
    if (seen.has(key)) {
      const existing = deduped[seen.get(key)];
      const existingDate = existing.filedDate ? new Date(existing.filedDate) : new Date(0);
      const newDate = c.filedDate ? new Date(c.filedDate) : new Date(0);
      if (newDate > existingDate) deduped[seen.get(key)] = c;
    } else {
      seen.set(key, deduped.length);
      deduped.push(c);
    }
  }
  const invalid = candidates.filter(c => !c.chamber || !c.district);
  const dupCount = valid.length - deduped.length;
  console.log(`  Parsed ${deduped.length} candidates (${invalid.length} unparseable, ${dupCount} duplicates removed)`);
  return { candidates: deduped, invalidCandidates: invalid };
}

async function fetchRosters() {
  const roster = {};
  const fetches = [['house', config.roster_house_url], ['senate', config.roster_senate_url]];

  await Promise.all(fetches.map(async ([chamber, url]) => {
    try {
      const res = await httpGet(url);
      if (res.statusCode !== 200) { console.log(`    WARN: HTTP ${res.statusCode} fetching ${chamber} roster`); return; }
      const $ = cheerio.load(res.body);
      let memberCount = 0;

      $('table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const distCellText = $(cells[1]).text().trim();
        const distMatch = distCellText.match(/(\d{1,2})/);
        if (!distMatch) return;
        const dist = parseInt(distMatch[1], 10);
        if (dist < 1 || dist > 30) return;

        let memberName = null;
        $(row).find('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const linkText = $(el).text().trim();
          if ((href.includes('Member') || href.includes('member')) && linkText.length > 2) memberName = linkText;
        });
        if (!memberName) {
          const firstCell = $(cells[0]).text().trim();
          if (firstCell.length > 2 && /[a-zA-Z]/.test(firstCell) && !/^\d+$/.test(firstCell)) memberName = firstCell;
        }

        if (memberName && dist) {
          memberName = memberName.replace(/\s*--\s*.*$/, '').trim();
          const key = `${dist}_${chamber}`;
          if (!roster[key]) roster[key] = [];
          if (!roster[key].includes(memberName)) { roster[key].push(memberName); memberCount++; }
        }
      });

      // Fallback: div-based layout
      if (memberCount === 0) {
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href.includes('Member') && !href.includes('member')) return;
          let name = $(el).text().trim().replace(/\s*--\s*.*$/, '').trim();
          if (name.length < 3) return;
          const parent = $(el).closest('tr, div, li');
          const parentText = parent.text();
          const dm = parentText.match(/\b(\d{1,2})\b/);
          if (!dm) return;
          const d = parseInt(dm[1], 10);
          if (d < 1 || d > 30) return;
          const key = `${d}_${chamber}`;
          if (!roster[key]) roster[key] = [];
          if (!roster[key].includes(name)) { roster[key].push(name); memberCount++; }
        });
      }
      console.log(`    ${chamber}: ${memberCount} members`);
    } catch (err) {
      console.log(`    ERROR fetching ${chamber} roster: ${err.message}`);
    }
  }));

  return roster;
}

async function fetchFinanceEntities(flags) {
  const postBody = 'draw=1&start=0&length=5000&order[0][column]=0&order[0][dir]=asc&search[value]=&search[regex]=false';
  const contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
  const entities = new Map();

  const calls = [['active', 'false'], ['less_active', 'true']];
  await Promise.all(calls.map(async ([label, isLessActive]) => {
    const url = `${config.finance_api_url}?Page=1&startYear=2025&endYear=${CYCLE_YEAR}&JurisdictionId=0&TablePage=1&TableLength=5000&IsLessActive=${isLessActive}&ShowOfficeHolder=false&ChartName=1`;
    try {
      const res = await httpPost(url, postBody, contentType);
      if (res.statusCode !== 200) {
        console.log(`    WARN: HTTP ${res.statusCode} for ${label} entities`);
        flags.push({ type: 'api_error', detail: `Finance API returned HTTP ${res.statusCode} for ${label} entities`, url });
        return;
      }
      let json;
      try { json = JSON.parse(res.body); } catch (e) {
        flags.push({ type: 'api_error', detail: `Finance API returned invalid JSON for ${label} entities`, url });
        return;
      }
      const data = json.data || [];
      console.log(`    ${label}: ${data.length} entities`);
      for (const entity of data) {
        const eid = entity.EntityID;
        if (!eid) continue;
        if (entities.has(eid) && label === 'less_active') continue;
        entities.set(eid, { ...entity, source: label === 'active' ? 'active' : 'less_active' });
      }
    } catch (err) {
      console.log(`    ERROR fetching ${label} entities: ${err.message}`);
      flags.push({ type: 'api_error', detail: `Failed to fetch ${label} entities: ${err.message}`, url });
    }
  }));

  console.log(`    Merged: ${entities.size} unique entities`);
  return entities;
}

// Per-entity status via GetDetailedInformation (returns Active/Terminated/Suspended).
// Used to disambiguate when multiple entities match the same candidate.
async function fetchEntityStatus(entityId) {
  const url = `https://seethemoney.az.gov/Reporting/GetDetailedInformation?Page=11&startYear=2025&endYear=${CYCLE_YEAR}&JurisdictionId=0&TablePage=1&TableLength=10&Name=1~${entityId}`;
  try {
    const res = await httpPost(url, '', 'application/x-www-form-urlencoded; charset=UTF-8');
    if (res.statusCode !== 200) return null;
    const json = JSON.parse(res.body);
    const info = json.ReportFilerInfo || json;
    return info.Status || null;
  } catch {
    return null;
  }
}

// Nickname variants for fuzzy entity matching (Tier 1)
const NICKNAMES = {
  'walt': ['walter'], 'walter': ['walt'],
  'bill': ['william'], 'william': ['bill'],
  'bob': ['robert'], 'rob': ['robert'], 'robbie': ['robert'],
  'robert': ['bob', 'rob', 'robbie'],
  'mike': ['michael'], 'michael': ['mike'],
  'jim': ['james'], 'james': ['jim'],
  'joe': ['joseph'], 'joseph': ['joe'],
  'tom': ['thomas'], 'thomas': ['tom'],
  'dick': ['richard'], 'rick': ['richard'],
  'richard': ['dick', 'rick'],
  'nick': ['nicholas', 'nickolas'], 'nicholas': ['nick'], 'nickolas': ['nick'],
  'chris': ['christopher'], 'christopher': ['chris'],
  'dan': ['daniel'], 'daniel': ['dan'],
  'dave': ['david'], 'david': ['dave'],
  'ed': ['edward'], 'edward': ['ed'],
  'pat': ['patricia'], 'patty': ['patricia'],
  'patricia': ['pat', 'patty'],
  'liz': ['elizabeth'], 'beth': ['elizabeth'],
  'elizabeth': ['liz', 'beth'],
  'sue': ['susan'], 'susan': ['sue'],
  'tony': ['anthony'], 'anthony': ['tony'],
  'steve': ['steven', 'stephen'], 'steven': ['steve'], 'stephen': ['steve'],
  'jeff': ['jeffrey'], 'jeffrey': ['jeff'],
  'matt': ['matthew'], 'matthew': ['matt'],
  'sam': ['samuel'], 'samuel': ['sam'],
  'larry': ['lawrence'], 'lawrence': ['larry'],
  'ted': ['theodore'], 'theodore': ['ted'],
  'al': ['albert'], 'albert': ['al'],
  'ben': ['benjamin'], 'benjamin': ['ben'],
  'don': ['donald'], 'donald': ['don'],
  'ron': ['ronald'], 'ronald': ['ron'],
  'tim': ['timothy'], 'timothy': ['tim'],
  'jerry': ['gerald'], 'gerald': ['jerry'],
  'marty': ['martin'], 'martin': ['marty'],
  'sandy': ['sandra'], 'sandra': ['sandy'],
  'vince': ['vincent'], 'vincent': ['vince'],
  'gene': ['eugene'], 'eugene': ['gene'],
  'gail': ['abigail'], 'abigail': ['gail'],
  'deb': ['deborah'], 'debbie': ['deborah'],
  'deborah': ['deb', 'debbie'],
  'barb': ['barbara'], 'barbara': ['barb'],
};

// Levenshtein distance for fuzzy entity matching (Tier 2)
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

async function matchCandidates(candidates, entities, flags) {
  // Index entities by last_name + district + chamber — NO name-only fallback
  const entityIndex = new Map();

  for (const [eid, entity] of entities) {
    const cleanedName = cleanEntityName(entity.EntityLastName);
    const norm = normalizeName(cleanedName);
    const { chamber, district } = parseOfficeName(entity.OfficeName);

    if (chamber && district) {
      const key = `${norm.last}_${district}_${chamber}`;
      if (!entityIndex.has(key)) entityIndex.set(key, []);
      entityIndex.get(key).push({ ...entity, _parsedChamber: chamber, _parsedDistrict: district, _cleanedName: cleanedName });
    }
    // Entities without OfficeName are NOT indexed — no name-only fallback
  }

  let matchCount = 0, noMatchCount = 0;

  for (const candidate of candidates) {
    const candNorm = normalizeName(candidate.name);
    const key = `${candNorm.last}_${candidate.district}_${candidate.chamber}`;
    let matches = entityIndex.get(key) || [];

    if (matches.length === 0) {
      // Tier 1 — Nickname expansion: try common name variants
      let fuzzyEntityFound = false;
      const nickVariants = NICKNAMES[candNorm.first];
      if (nickVariants) {
        for (const variant of nickVariants) {
          const variantKey = `${variant}_${candNorm.last}_${candidate.district}_${candidate.chamber}`;
          const variantMatches = entityIndex.get(variantKey) || [];
          if (variantMatches.length === 1) {
            flags.push({
              type: 'fuzzy_entity_match',
              candidate_name: candidate.name,
              district: candidate.district,
              chamber: candidate.chamber,
              party: candidate.party,
              match_method: 'nickname',
              nickname_from: candNorm.first,
              nickname_to: variant,
              potential_entity_id: variantMatches[0].EntityID,
              potential_entity_name: cleanEntityName(variantMatches[0].EntityLastName),
              auto_set: false,
            });
            fuzzyEntityFound = true;
            break;
          }
        }
      }

      // Tier 2 — Levenshtein distance on last names (same district+chamber)
      if (!fuzzyEntityFound) {
        const levMatches = [];
        for (const [eKey, eList] of entityIndex) {
          // Parse the key: last_district_chamber
          const parts = eKey.split('_');
          const eChamber = parts[parts.length - 1];
          const eDistrict = parts[parts.length - 2];
          if (eChamber !== candidate.chamber || String(eDistrict) !== String(candidate.district)) continue;
          const eLast = parts.slice(0, parts.length - 2).join('_');
          const dist = levenshtein(candNorm.last, eLast);
          if (dist > 0 && dist <= 2) {
            for (const ent of eList) {
              levMatches.push({ entity: ent, distance: dist, entityLast: eLast });
            }
          }
        }
        if (levMatches.length === 1) {
          flags.push({
            type: 'fuzzy_entity_match',
            candidate_name: candidate.name,
            district: candidate.district,
            chamber: candidate.chamber,
            party: candidate.party,
            match_method: 'levenshtein',
            distance: levMatches[0].distance,
            potential_entity_id: levMatches[0].entity.EntityID,
            potential_entity_name: cleanEntityName(levMatches[0].entity.EntityLastName),
            auto_set: false,
          });
          fuzzyEntityFound = true;
        }
      }

      candidate.entity_id = null;
      candidate.financing = '-';
      candidate.matchStatus = 'no_match';
      noMatchCount++;
      if (!fuzzyEntityFound) {
        flags.push({ type: 'no_match', candidate_name: candidate.name, district: candidate.district, chamber: candidate.chamber, party: candidate.party });
      }
      continue;
    }

    if (matches.length === 1) {
      const m = matches[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = deriveFinancing(m.EntityTypeName);
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'matched';
      candidate._entitySource = m.source;
      matchCount++;
      continue;
    }

    // Multiple matches — disambiguate using per-entity Status from GetDetailedInformation
    const statusResults = await Promise.all(matches.map(async m => {
      const status = await fetchEntityStatus(m.EntityID);
      return { ...m, entityStatus: status };
    }));
    const activeByStatus = statusResults.filter(m => m.entityStatus === 'Active');

    if (activeByStatus.length === 1) {
      const m = activeByStatus[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = deriveFinancing(m.EntityTypeName);
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'matched';
      candidate._entitySource = m.source;
      candidate._entityStatus = m.entityStatus;
      matchCount++;
    } else if (activeByStatus.length === 0) {
      // No entity has Active status — use first match, flag for review
      const m = statusResults[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = deriveFinancing(m.EntityTypeName);
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'no_active';
      flags.push({ type: 'no_active', candidate_name: candidate.name, district: candidate.district, chamber: candidate.chamber, entity_ids: matches.map(m => m.EntityID), statuses: statusResults.map(m => ({ id: m.EntityID, status: m.entityStatus })) });
      matchCount++;
    } else {
      // Multiple Active — flag for review, use first
      const m = activeByStatus[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = deriveFinancing(m.EntityTypeName);
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'multiple_active';
      flags.push({ type: 'multiple_active', candidate_name: candidate.name, district: candidate.district, chamber: candidate.chamber, entity_ids: activeByStatus.map(m => m.EntityID), statuses: statusResults.map(m => ({ id: m.EntityID, status: m.entityStatus })) });
      matchCount++;
    }
  }

  console.log(`  Matched: ${matchCount}/${candidates.length} (${noMatchCount} no-match)`);
}

function detectIncumbents(candidates, roster, flags) {
  const allLegislators = [];
  for (const [key, names] of Object.entries(roster)) {
    for (const name of names) {
      allLegislators.push({ name, key });
    }
  }
  console.log(`  Total legislators in roster: ${allLegislators.length}`);

  let exactCount = 0;
  let fuzzyCount = 0;

  for (const candidate of candidates) {
    if (allLegislators.length === 0) {
      candidate.incumbent = false;
      continue;
    }

    const candNorm = normalizeName(candidate.name);

    // Pass 1: Exact match against ALL legislators
    let matched = false;
    for (const leg of allLegislators) {
      const rNorm = normalizeName(leg.name);
      if (candNorm.full === rNorm.full) {
        candidate.incumbent = true;
        matched = true;
        exactCount++;
        break;
      }
    }

    if (matched) continue;

    // Pass 2: Fuzzy matching
    let fuzzyMatch = null;
    let matchMethod = null;

    for (const leg of allLegislators) {
      const rNorm = normalizeName(leg.name);
      if (candNorm.last === rNorm.last && candNorm.firstInitial === rNorm.firstInitial) {
        fuzzyMatch = leg.name;
        matchMethod = 'first_initial_and_last_name';
        break;
      }
      if (candNorm.full.includes(rNorm.full) || rNorm.full.includes(candNorm.full)) {
        fuzzyMatch = leg.name;
        matchMethod = 'substring_containment';
        break;
      }
    }

    // Last name only — flag but do NOT auto-set
    if (!fuzzyMatch) {
      for (const leg of allLegislators) {
        const rNorm = normalizeName(leg.name);
        if (candNorm.last === rNorm.last) {
          fuzzyMatch = leg.name;
          matchMethod = 'last_name_only';
          break;
        }
      }
    }

    if (fuzzyMatch) {
      fuzzyCount++;
      const autoSet = matchMethod !== 'last_name_only';
      flags.push({
        type: 'fuzzy_incumbent_match',
        candidate_name: candidate.name,
        roster_name: fuzzyMatch,
        district: candidate.district,
        chamber: candidate.chamber,
        match_method: matchMethod,
        auto_set: autoSet,
      });
      candidate.incumbent = autoSet;
    } else {
      candidate.incumbent = false;
    }
  }

  // Note: suspended_nonincumbent flags are created after Phase B,
  // once entity status has been fetched from seethemoney API.

  console.log(`  Exact incumbent matches: ${exactCount}`);
  console.log(`  Fuzzy incumbent matches: ${fuzzyCount}`);
  console.log(`  Non-incumbents: ${candidates.filter(c => !c.incumbent).length}`);
}

// ===========================================================================
// Phase B: Per-Candidate Streaming Pipeline
// ===========================================================================

function findDollarAmounts(text) {
  return [...text.matchAll(/(?:\(\$[\d,]+\.\d{2}\)|\$[\d,]+\.\d{2}|-\$[\d,]+\.\d{2})/g)].map(m => {
    const raw = m[0];
    if (raw.startsWith('(') && raw.endsWith(')')) return '-' + raw.slice(1, -1);
    return raw;
  });
}

/**
 * Extract finance data from a campaign finance PDF.
 * Extraction strategy:
 *   Page 1 (cash_balance): Use -layout mode for ordered amounts from Summary of Finances.
 *     The 4 amounts in order are: beginning, receipts, disbursements, end balance.
 *     If only 3 amounts (end balance missing), compute it from the other three.
 *   Page 2 (income/expenses): Positional extraction from post-Covers sections split by
 *     "Total to Date". Section 0 = income this period (12 amounts, last = Total Income),
 *     Section 1 = income totals (12) + expense this period, Section 2 = expense totals.
 *     High confidence when section has expected count; low confidence otherwise.
 */
function extractFinanceFromPdf(pdfPath) {
  const result = { cash_balance: null, income_this_period: null, income_total: null, expenses_total: null };
  const lowConfidenceFields = [];
  const errors = [];

  // Page 1: Cash Balance at End of Reporting Period
  try {
    const page1 = execFileSync('pdftotext', ['-layout', '-f', '1', '-l', '1', pdfPath, '-'], { encoding: 'utf8' });

    const summaryIdx = page1.indexOf('Summary of Finances');
    if (summaryIdx !== -1) {
      const afterSummary = page1.substring(summaryIdx);
      const amounts = findDollarAmounts(afterSummary);
      // Layout mode preserves order: [beginning, receipts, disbursements, end]
      if (amounts.length >= 4) {
        result.cash_balance = amounts[3];
      } else if (amounts.length === 3) {
        // End balance missing from PDF — compute: end = beginning + receipts - disbursements
        const parse = (s) => parseFloat(s.replace(/[$,]/g, ''));
        const beginning = parse(amounts[0]);
        const receipts = parse(amounts[1]);
        const disbursements = parse(amounts[2]);
        if (!isNaN(beginning) && !isNaN(receipts) && !isNaN(disbursements)) {
          const end = beginning + receipts - disbursements;
          result.cash_balance = (end < 0 ? '-' : '') + '$' + Math.abs(end).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          lowConfidenceFields.push('cash_balance');
        } else {
          result.cash_balance = amounts[amounts.length - 1];
          lowConfidenceFields.push('cash_balance');
        }
      } else if (amounts.length > 0) {
        result.cash_balance = amounts[amounts.length - 1];
        lowConfidenceFields.push('cash_balance');
      } else {
        errors.push('Page 1: No dollar amounts found after "Summary of Finances"');
      }
    } else {
      errors.push('Page 1: Could not find "Summary of Finances"');
    }
  } catch (e) { errors.push(`Page 1 extraction failed: ${e.message}`); }

  // Page 2: Income and Expenses from Summary of Activity
  try {
    const page2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', pdfPath, '-'], { encoding: 'utf8' });

    const coversMatch = page2.match(/Covers \d{2}\/\d{2}\/\d{4} to \d{2}\/\d{2}\/\d{4}/);
    const coversIdx = coversMatch ? page2.indexOf(coversMatch[0]) : -1;
    const afterCovers = coversIdx !== -1 ? page2.substring(coversIdx) : page2;
    const sections = afterCovers.split('Total to Date');

    // Section 0 (before 1st "Total to Date"): income this-period amounts
    // Standard layout has 12 amounts; the 12th (index 11) = Total Income this period
    if (sections.length >= 1) {
      const section0Amounts = findDollarAmounts(sections[0]);
      if (section0Amounts.length >= 12) {
        result.income_this_period = section0Amounts[11];
      } else if (section0Amounts.length > 0) {
        result.income_this_period = section0Amounts[section0Amounts.length - 1];
        lowConfidenceFields.push('income_this_period');
      }
    }

    // Section 1 (1st "Total to Date" block): first 12 amounts = income totals
    if (sections.length >= 2) {
      const section1Amounts = findDollarAmounts(sections[1]);
      if (section1Amounts.length >= 12) {
        result.income_total = section1Amounts[11];
      } else if (section1Amounts.length > 0) {
        result.income_total = section1Amounts[section1Amounts.length - 1];
        lowConfidenceFields.push('income_total');
      }
    }
    if (!result.income_total) {
      errors.push('Page 2: Failed to extract income_total');
    }

    // Section 2 (2nd "Total to Date" block): expense totals
    // Standard layout has 9 amounts; second-to-last (index length-2) = Total Expenditures
    if (sections.length >= 3) {
      const section2Amounts = findDollarAmounts(sections[2]);
      if (section2Amounts.length >= 9) {
        result.expenses_total = section2Amounts[section2Amounts.length - 2];
      } else if (section2Amounts.length >= 2) {
        result.expenses_total = section2Amounts[section2Amounts.length - 2];
        lowConfidenceFields.push('expenses_total');
      } else if (section2Amounts.length === 1) {
        result.expenses_total = section2Amounts[0];
        lowConfidenceFields.push('expenses_total');
      }
    }
    if (!result.expenses_total) {
      errors.push('Page 2: Failed to extract expenses_total');
    }

    if (sections.length < 2 && !result.income_this_period) {
      errors.push('Page 2: Could not find "Total to Date" sections');
    }
    if (sections.length < 3 && !result.expenses_total) {
      errors.push('Page 2: No expense "Total to Date" section found');
    }
  } catch (e) { errors.push(`Page 2 extraction failed: ${e.message}`); }

  if (lowConfidenceFields.length > 0) result.low_confidence_fields = lowConfidenceFields;
  if (errors.length > 0) result.errors = errors;
  return result;
}

async function processCandidate(candidate, pdfDir) {
  const candNorm = normalizeName(candidate.name);
  const last = candNorm.last;
  const first = candNorm.first;

  // Fetch entity status (Active/Suspended/Terminated) from seethemoney API
  if (candidate.entity_id && !candidate._entityStatus) {
    const status = await fetchEntityStatus(candidate.entity_id);
    candidate._entityStatus = status;
    if (/suspended|terminated/i.test(status || '')) {
      candidate.suspended = true;
    }
  }

  if (!candidate.entity_id) {
    candidate.pdf_url = null;
    candidate.pdf_filename = null;
    candidate.filing_date = null;
    candidate.cash_balance = null;
    candidate.income_this_period = null;
    candidate.income_total = null;
    candidate.expenses_total = null;
    return { status: 'no_entity' };
  }

  const reportsUrl = `${config.reports_api_url}?Name=1~${candidate.entity_id}&ChartName=11&ShowAllYears=true`;

  try {
    const res = await httpGet(reportsUrl);
    if (res.statusCode !== 200) {
      candidate.pdf_url = null; candidate.pdf_filename = null; candidate.filing_date = null;
      candidate.cash_balance = null; candidate.income_this_period = null; candidate.income_total = null; candidate.expenses_total = null;
      return { status: 'api_error', error: `HTTP ${res.statusCode}` };
    }
    let json;
    try { json = JSON.parse(res.body); } catch (e) {
      candidate.pdf_url = null; candidate.pdf_filename = null; candidate.filing_date = null;
      candidate.cash_balance = null; candidate.income_this_period = null; candidate.income_total = null; candidate.expenses_total = null;
      return { status: 'parse_error', error: 'Invalid JSON from reports API' };
    }

    const reports = Array.isArray(json) ? json : (json.data || json.aaData || []);
    const cycleReports = reports.filter(r => (r.CycleYear || r.cycleYear) == CYCLE_YEAR);

    if (cycleReports.length === 0) {
      candidate.pdf_url = null; candidate.pdf_filename = null; candidate.filing_date = null;
      candidate.cash_balance = null; candidate.income_this_period = null; candidate.income_total = null; candidate.expenses_total = null;
      return { status: 'no_report' };
    }

    cycleReports.sort((a, b) => new Date(b.FilingDate || b.filingDate || 0) - new Date(a.FilingDate || a.filingDate || 0));
    const latest = cycleReports[0];
    const reportUrl = latest.ReportFileURL || latest.reportFileURL || latest.ReportFileUrl || null;
    const filingDate = latest.FilingDate || latest.filingDate || null;

    let filingDateStr = null;
    if (filingDate) {
      const d = new Date(filingDate);
      if (!isNaN(d)) filingDateStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
      else filingDateStr = filingDate;
    }

    let pdfFilename = null;
    if (filingDate) {
      const d = new Date(filingDate);
      if (!isNaN(d)) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        pdfFilename = sanitizeFilename(`${last}, ${first} - ${mm}-${dd}-${yy}.pdf`);
      }
    }

    candidate.pdf_url = reportUrl;
    candidate.pdf_filename = pdfFilename;
    candidate.filing_date = filingDateStr;

    // Download PDF
    if (!reportUrl || !pdfFilename) {
      candidate.cash_balance = null; candidate.income_this_period = null; candidate.income_total = null; candidate.expenses_total = null;
      return { status: 'no_pdf_url' };
    }

    const ldDir = path.join(pdfDir, 'LD' + candidate.district);
    fs.mkdirSync(ldDir, { recursive: true });
    const pdfPath = path.join(ldDir, pdfFilename);
    let pdfDownloaded = false;

    if (fs.existsSync(pdfPath)) {
      pdfDownloaded = true;
    } else {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await httpGetBinary(reportUrl);
          if (buf.length < 5 || buf.slice(0, 5).toString('ascii') !== '%PDF-') {
            if (attempt === 0) continue;
            candidate.cash_balance = '-'; candidate.income_this_period = '-'; candidate.income_total = '-'; candidate.expenses_total = '-';
            return { status: 'corrupt_pdf' };
          }
          fs.writeFileSync(pdfPath, buf);
          pdfDownloaded = true;
          break;
        } catch (err) {
          if (attempt === 1) {
            candidate.cash_balance = '-'; candidate.income_this_period = '-'; candidate.income_total = '-'; candidate.expenses_total = '-';
            return { status: 'download_error', error: err.message };
          }
        }
      }
    }

    if (!pdfDownloaded) {
      candidate.cash_balance = '-'; candidate.income_this_period = '-'; candidate.income_total = '-'; candidate.expenses_total = '-';
      return { status: 'no_pdf_file' };
    }

    // Extract finance data (synchronous pdftotext inside extractFinanceFromPdf)
    try {
      const extracted = extractFinanceFromPdf(pdfPath);
      candidate.cash_balance = extracted.cash_balance || '-';
      candidate.income_this_period = extracted.income_this_period || '-';
      candidate.income_total = extracted.income_total || '-';
      candidate.expenses_total = extracted.expenses_total || '-';
      candidate.low_confidence_fields = extracted.low_confidence_fields || [];
      if (extracted.errors && extracted.errors.length > 0) {
        return { status: 'extraction_partial', errors: extracted.errors };
      }
      return { status: 'ok' };
    } catch (err) {
      candidate.cash_balance = '-'; candidate.income_this_period = '-'; candidate.income_total = '-'; candidate.expenses_total = '-';
      return { status: 'extraction_error', error: err.message };
    }
  } catch (err) {
    candidate.pdf_url = null; candidate.pdf_filename = null; candidate.filing_date = null;
    candidate.cash_balance = null; candidate.income_this_period = null; candidate.income_total = null; candidate.expenses_total = null;
    return { status: 'fetch_error', error: err.message };
  }
}

// ===========================================================================
// Phase C: Docx Update
// ===========================================================================

function getElementsByLocalName(node, localName) {
  const results = [];
  const children = node.childNodes;
  if (!children) return results;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1) {
      if (child.localName === localName) results.push(child);
      results.push(...getElementsByLocalName(child, localName));
    }
  }
  return results;
}

function getChildElements(parent, localName, ns) {
  const results = [];
  const children = parent.childNodes;
  if (!children) return results;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1 && child.localName === localName) {
      if (!ns || child.namespaceURI === ns) results.push(child);
    }
  }
  return results;
}

function getWordText(node) {
  const textEls = getElementsByLocalName(node, 't');
  let text = '';
  for (const t of textEls) {
    if (t.namespaceURI === W_NS || !t.namespaceURI) text += t.textContent || '';
  }
  return text;
}

function getCellText(row) {
  const cells = getChildElements(row, 'tc', W_NS);
  if (cells.length === 0) return '';
  return getWordText(cells[0]).trim();
}

function rowHasColor(row) {
  const rPrs = getElementsByLocalName(row, 'rPr');
  for (const rPr of rPrs) {
    if (rPr.namespaceURI !== W_NS && rPr.namespaceURI) continue;
    if (getChildElements(rPr, 'color', W_NS).length > 0) return true;
  }
  return false;
}

function getTableRows(tbl) { return getChildElements(tbl, 'tr', W_NS); }

function setCellText(cell, text, doc) {
  const runs = getElementsByLocalName(cell, 'r');
  if (runs.length === 0) {
    const p = getElementsByLocalName(cell, 'p')[0];
    if (!p) return;
    const r = doc.createElementNS(W_NS, 'w:r');
    const t = doc.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = text;
    r.appendChild(t);
    p.appendChild(r);
    return;
  }
  let firstTextSet = false;
  for (const r of runs) {
    const tEls = getChildElements(r, 't', W_NS);
    for (const t of tEls) {
      if (!firstTextSet) { t.textContent = text; t.setAttribute('xml:space', 'preserve'); firstTextSet = true; }
      else t.textContent = '';
    }
  }
  if (!firstTextSet) {
    const t = doc.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = text;
    runs[0].appendChild(t);
  }
}

function ensureElement(parent, localName, doc) {
  const existing = getChildElements(parent, localName, W_NS);
  if (existing.length > 0) return existing[0];
  const el = doc.createElementNS(W_NS, 'w:' + localName);
  parent.appendChild(el);
  return el;
}

function removeElements(parent, localName) {
  const toRemove = getChildElements(parent, localName, W_NS);
  for (const el of toRemove) parent.removeChild(el);
}

function getAllRPrs(row, doc) {
  const runs = getElementsByLocalName(row, 'r');
  const rPrs = [];
  for (const r of runs) {
    if (r.namespaceURI !== W_NS && r.namespaceURI) continue;
    let rPr = getChildElements(r, 'rPr', W_NS)[0];
    if (!rPr) { rPr = doc.createElementNS(W_NS, 'w:rPr'); r.insertBefore(rPr, r.firstChild); }
    rPrs.push(rPr);
  }
  return rPrs;
}

function setRowColor(row, hexColor, doc) {
  // Update run-level rPr colors
  for (const rPr of getAllRPrs(row, doc)) {
    let colorEls = getChildElements(rPr, 'color', W_NS);
    if (colorEls.length > 0) colorEls[0].setAttributeNS(W_NS, 'w:val', hexColor);
    else { const c = doc.createElementNS(W_NS, 'w:color'); c.setAttributeNS(W_NS, 'w:val', hexColor); rPr.appendChild(c); }
  }
  // Also update paragraph-level default rPr colors (pPr/rPr) for consistency
  const pPrs = getElementsByLocalName(row, 'pPr');
  for (const pPr of pPrs) {
    if (pPr.namespaceURI !== W_NS && pPr.namespaceURI) continue;
    const rPrs = getChildElements(pPr, 'rPr', W_NS);
    for (const rPr of rPrs) {
      let colorEls = getChildElements(rPr, 'color', W_NS);
      if (colorEls.length > 0) colorEls[0].setAttributeNS(W_NS, 'w:val', hexColor);
      else { const c = doc.createElementNS(W_NS, 'w:color'); c.setAttributeNS(W_NS, 'w:val', hexColor); rPr.appendChild(c); }
    }
  }
}

function setBold(row, bold, doc) {
  for (const rPr of getAllRPrs(row, doc)) {
    if (bold) { ensureElement(rPr, 'b', doc); ensureElement(rPr, 'bCs', doc); }
    else { removeElements(rPr, 'b'); removeElements(rPr, 'bCs'); }
  }
  // Also update paragraph-level default rPr for consistency
  const pPrs = getElementsByLocalName(row, 'pPr');
  for (const pPr of pPrs) {
    if (pPr.namespaceURI !== W_NS && pPr.namespaceURI) continue;
    const rPrs = getChildElements(pPr, 'rPr', W_NS);
    for (const rPr of rPrs) {
      if (bold) { ensureElement(rPr, 'b', doc); ensureElement(rPr, 'bCs', doc); }
      else { removeElements(rPr, 'b'); removeElements(rPr, 'bCs'); }
    }
  }
}

function setStrike(row, strike, doc) {
  for (const rPr of getAllRPrs(row, doc)) {
    if (strike) ensureElement(rPr, 'strike', doc);
    else removeElements(rPr, 'strike');
  }
  // Also update paragraph-level default rPr for consistency
  const pPrs = getElementsByLocalName(row, 'pPr');
  for (const pPr of pPrs) {
    if (pPr.namespaceURI !== W_NS && pPr.namespaceURI) continue;
    const rPrs = getChildElements(pPr, 'rPr', W_NS);
    for (const rPr of rPrs) {
      if (strike) ensureElement(rPr, 'strike', doc);
      else removeElements(rPr, 'strike');
    }
  }
}

function fmtVal(val) {
  if (val === null || val === undefined || val === '') return '-';
  return String(val);
}

function partyColor(party) {
  return PARTY_COLORS[party] || PARTY_COLORS['default'] || '000000';
}

/**
 * Update the "Last Edited" field in the document to today's date.
 * Searches all paragraphs for text containing "Last Edited", then
 * finds and replaces the date portion.
 */
function updateLastEdited(doc) {
  const allParagraphs = doc.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < allParagraphs.length; i++) {
    const p = allParagraphs[i];
    const text = getWordText(p);
    if (!/last\s*edited/i.test(text)) continue;

    // Found the "Last Edited" paragraph — update the date
    const today = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const todayStr = `${months[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

    // Try to find and replace a date pattern in the runs
    const runs = getElementsByLocalName(p, 'r');
    // Collect all text nodes to find the date
    let fullText = '';
    const textNodes = [];
    for (const r of runs) {
      const tEls = getChildElements(r, 't', W_NS);
      for (const t of tEls) {
        textNodes.push({ node: t, start: fullText.length, text: t.textContent || '' });
        fullText += t.textContent || '';
      }
    }

    // Match common date formats: "Month DD, YYYY", "MM/DD/YYYY", "YYYY-MM-DD"
    const datePatterns = [
      /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
      /\d{1,2}\/\d{1,2}\/\d{4}/,
      /\d{4}-\d{2}-\d{2}/,
    ];

    let dateMatch = null;
    for (const pattern of datePatterns) {
      dateMatch = fullText.match(pattern);
      if (dateMatch) break;
    }

    if (dateMatch) {
      const matchStart = dateMatch.index;
      const matchEnd = matchStart + dateMatch[0].length;

      // Replace the date across text nodes
      let replaced = false;
      for (const tn of textNodes) {
        const tnEnd = tn.start + tn.text.length;
        if (tn.start <= matchStart && tnEnd >= matchEnd) {
          // Date is entirely within this text node
          tn.node.textContent = tn.text.substring(0, matchStart - tn.start) + todayStr + tn.text.substring(matchEnd - tn.start);
          replaced = true;
          break;
        }
        if (tn.start >= matchStart && tnEnd <= matchEnd) {
          // This text node is entirely within the date — clear it or set to new date
          if (!replaced) {
            tn.node.textContent = todayStr;
            replaced = true;
          } else {
            tn.node.textContent = '';
          }
        } else if (tn.start < matchStart && tnEnd > matchStart) {
          // Date starts partway through this node
          tn.node.textContent = tn.text.substring(0, matchStart - tn.start) + todayStr;
          replaced = true;
        } else if (tn.start < matchEnd && tnEnd > matchEnd) {
          // Date ends partway through this node
          tn.node.textContent = tn.text.substring(matchEnd - tn.start);
        }
      }

      if (replaced) {
        console.log(`  Last Edited updated to: ${todayStr}`);
        return true;
      }
    }

    // Fallback: if no date pattern found, append today's date after "Last Edited"
    // Find the run containing "Last Edited" and add date after it
    for (const r of runs) {
      const tEls = getChildElements(r, 't', W_NS);
      for (const t of tEls) {
        const content = t.textContent || '';
        if (/last\s*edited/i.test(content)) {
          // Check if there's a colon/dash separator
          const sepMatch = content.match(/last\s*edited\s*[:–—-]?\s*/i);
          if (sepMatch) {
            t.textContent = content.substring(0, sepMatch.index + sepMatch[0].length) + todayStr;
          } else {
            t.textContent = content + ' ' + todayStr;
          }
          console.log(`  Last Edited updated to: ${todayStr}`);
          return true;
        }
      }
    }
  }
  console.log('  WARNING: "Last Edited" field not found in document — date not updated');
  return false;
}

async function updateDocx(dataPath, notebookPath, outputPath) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const docxBuffer = fs.readFileSync(notebookPath);
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXmlText = await zip.file('word/document.xml').async('string');
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(docXmlText, 'application/xml');

  const stats = { districtsProcessed: 0, candidatesUpdated: 0, candidatesAdded: 0, candidatesRemoved: 0, strikethroughApplied: 0, boldApplied: 0, addedDetails: [], removedDetails: [], warnings: [] };

  // Pre-process flags: apply incumbent overrides and build removal set
  const removalSet = new Set();
  if (data.flags && data.districts) {
    for (const flag of data.flags) {
      // Fuzzy incumbent match overrides
      if (flag.type === 'fuzzy_incumbent_match') {
        // Find the candidate in districts data
        const distData = data.districts[String(flag.district)];
        if (!distData) continue;
        const chamber = (flag.chamber || '').toLowerCase();
        const candidates = distData[chamber];
        if (!candidates) continue;
        const candNorm = normalizeName(flag.candidate_name).full;
        const cand = candidates.find(c => normalizeName(c.name).full === candNorm);
        if (!cand) continue;

        if (flag.auto_set) {
          // auto_set:true — incumbent was set. If rejected, unset it
          if (flag.rejected === true) {
            cand.incumbent = false;
          }
          // Otherwise (no rejected field or confirmed:true) — stays incumbent
        } else {
          // auto_set:false (last_name_only) — incumbent was NOT set. If confirmed, set it
          if (flag.confirmed === true) {
            cand.incumbent = true;
          }
          // Otherwise — stays non-incumbent
        }
      }

      // Fuzzy entity match confirmations — set entity_id from confirmed flag
      if (flag.type === 'fuzzy_entity_match' && flag.confirmed === true && flag.potential_entity_id) {
        const distData = data.districts[String(flag.district)];
        if (!distData) continue;
        const chamber = (flag.chamber || '').toLowerCase();
        const candidates = distData[chamber];
        if (!candidates) continue;
        const candNorm = normalizeName(flag.candidate_name).full;
        const cand = candidates.find(c => normalizeName(c.name).full === candNorm);
        if (!cand) continue;
        cand.entity_id = flag.potential_entity_id;
        cand.matchStatus = 'matched';
        // Mark for finance data re-fetch
        if (!data._fuzzyEntityRefetch) data._fuzzyEntityRefetch = [];
        data._fuzzyEntityRefetch.push(cand);
      }

      // Suspended nonincumbent removals
      if (flag.type === 'suspended_nonincumbent' && flag.approved === false) {
        removalSet.add(`${flag.district}|${(flag.chamber || '').toLowerCase()}|${normalizeName(flag.candidate_name || flag.name || '').full}`);
      }
    }
  }

  // Re-fetch finance data for confirmed fuzzy entity matches
  if (data._fuzzyEntityRefetch && data._fuzzyEntityRefetch.length > 0) {
    console.log(`  Re-fetching finance data for ${data._fuzzyEntityRefetch.length} confirmed fuzzy entity match(es)...`);
    const pdfDir = config.pdf_dir;
    for (const cand of data._fuzzyEntityRefetch) {
      const result = await processCandidate(cand, pdfDir);
      console.log(`    ${cand.name}: ${result.status}`);
    }
    delete data._fuzzyEntityRefetch;
  }

  // Update "Last Edited" field — check document.xml first, then header1.xml
  let lastEditedUpdated = updateLastEdited(doc);
  if (!lastEditedUpdated) {
    // Try header1.xml (some templates put "Last Edited" in the page header)
    const headerFile = zip.file('word/header1.xml');
    if (headerFile) {
      const headerXml = await headerFile.async('string');
      const headerDoc = domParser.parseFromString(headerXml, 'application/xml');
      lastEditedUpdated = updateLastEdited(headerDoc);
      if (lastEditedUpdated) {
        const serializer = new XMLSerializer();
        zip.file('word/header1.xml', serializer.serializeToString(headerDoc));
      }
    }
    if (!lastEditedUpdated) {
      console.log('  WARN: "Last Edited" field not found in document or header');
    }
  }

  const bodies = doc.getElementsByTagNameNS(W_NS, 'body');
  if (bodies.length === 0) { console.error('ERROR: No w:body found'); process.exit(1); }
  const body = bodies[0];
  const bodyChildren = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    if (body.childNodes[i].nodeType === 1) bodyChildren.push(body.childNodes[i]);
  }

  const districtPositions = new Map();
  for (let i = 0; i < bodyChildren.length; i++) {
    if (bodyChildren[i].localName === 'p') {
      const text = getWordText(bodyChildren[i]).trim();
      const match = text.match(/^Legislative\s+District\s+(\d+)$/i);
      if (match) districtPositions.set(parseInt(match[1]), i);
    }
  }

  for (let distNum = 1; distNum <= 30; distNum++) {
    const headingIdx = districtPositions.get(distNum);
    if (headingIdx === undefined) { stats.warnings.push(`District ${distNum}: heading not found`); continue; }

    let nextDistIdx = bodyChildren.length;
    for (const [d, idx] of districtPositions) {
      if (d !== distNum && idx > headingIdx && idx < nextDistIdx) nextDistIdx = idx;
    }

    let houseTable = null, senateTable = null;
    for (let i = headingIdx + 1; i < nextDistIdx; i++) {
      if (bodyChildren[i].localName !== 'tbl') continue;
      const tbl = bodyChildren[i];
      const tblRows = getTableRows(tbl);
      if (tblRows.length === 0) continue;
      const headerText = getWordText(tblRows[0]).trim().toLowerCase();
      if (!houseTable && headerText.includes('house candidates')) houseTable = tbl;
      else if (!senateTable && headerText.includes('senate candidates')) senateTable = tbl;
      if (houseTable && senateTable) break;
    }

    const chambers = [{ name: 'house', table: houseTable }, { name: 'senate', table: senateTable }];

    for (const { name: chamber, table } of chambers) {
      if (!table) continue;
      const distData = data.districts[String(distNum)];
      if (!distData || !distData[chamber]) continue;

      const candidates = distData[chamber];
      const rows = getTableRows(table);
      let candidateRows = [];

      for (let ri = 0; ri < rows.length; ri++) {
        if (rowHasColor(rows[ri])) candidateRows.push(rows[ri]);
      }
      if (candidateRows.length === 0 && rows.length > 2) {
        for (let ri = 2; ri < rows.length; ri++) candidateRows.push(rows[ri]);
      }

      // Use normalizeName().full for all row matching — unified normalization
      const existingByName = new Map();
      for (const cr of candidateRows) {
        const name = normalizeName(getCellText(cr)).full;
        if (name) existingByName.set(name, cr);
      }

      const matchedDataIndices = new Set();

      for (const [normName, row] of existingByName) {
        let matched = null, matchedIdx = -1;
        // Pass 1: exact normalized match
        for (let ci = 0; ci < candidates.length; ci++) {
          if (normalizeName(candidates[ci].name).full === normName) { matched = candidates[ci]; matchedIdx = ci; break; }
        }
        // Pass 1.5: reversed-name match — catches template entries like "Arabyan Vartan"
        // (last-first without comma) that normalizeName can't auto-detect
        if (!matched) {
          const existParts = normName.split(' ').filter(w => w.length > 0);
          if (existParts.length >= 2) {
            const reversed = existParts.slice().reverse().join(' ');
            for (let ci = 0; ci < candidates.length; ci++) {
              if (matchedDataIndices.has(ci)) continue;
              if (normalizeName(candidates[ci].name).full === reversed) {
                matched = candidates[ci]; matchedIdx = ci; break;
              }
            }
          }
        }
        // Pass 2: fuzzy match on last-name + name similarity, but only if unambiguous
        // Handles nickname spelling differences (e.g., "Hat Lady" vs "HatLady",
        // "Walt" vs "Walter", "TJ" vs "Thomas T.J.")
        if (!matched) {
          const existNorm = normalizeName(normName);
          const existWords = existNorm.full.split(' ').filter(w => w !== existNorm.last && w.length >= 2);
          const fuzzyHits = [];
          for (let ci = 0; ci < candidates.length; ci++) {
            if (matchedDataIndices.has(ci)) continue;
            const candNorm = normalizeName(candidates[ci].name);
            if (candNorm.last !== existNorm.last || candNorm.last.length <= 1) continue;
            // Require name similarity beyond just last name:
            // - any non-last word (>=2 chars) from template appears in SOI full name, OR
            // - first names share a 3+ character prefix
            const candWords = candNorm.full.split(' ');
            const sharedWord = existWords.some(ew => candWords.some(cw => cw === ew || cw.includes(ew) || ew.includes(cw)));
            const prefixLen = Math.min(existNorm.first.length, candNorm.first.length, 3);
            const sharedPrefix = prefixLen >= 3 && existNorm.first.substring(0, prefixLen) === candNorm.first.substring(0, prefixLen);
            if (sharedWord || sharedPrefix) {
              fuzzyHits.push(ci);
            }
          }
          if (fuzzyHits.length === 1) {
            matched = candidates[fuzzyHits[0]]; matchedIdx = fuzzyHits[0];
          }
        }

        const removalKey = `${distNum}|${chamber}|${normName}`;
        if (removalSet.has(removalKey)) {
          row.parentNode.removeChild(row);
          stats.candidatesRemoved++;
          stats.removedDetails.push(`${matched ? matched.name : normName} (LD${distNum} ${chamber})`);
          if (matchedIdx >= 0) matchedDataIndices.add(matchedIdx);
          continue;
        }

        if (!matched) continue;
        matchedDataIndices.add(matchedIdx);

        const cells = getChildElements(row, 'tc', W_NS);
        const values = [matched.name, fmtVal(matched.financing), fmtVal(matched.income_total), fmtVal(matched.income_this_period), fmtVal(matched.expenses_total), fmtVal(matched.cash_balance)];
        for (let ci = 0; ci < Math.min(cells.length, values.length); ci++) setCellText(cells[ci], values[ci], doc);

        setRowColor(row, partyColor(matched.party), doc);
        setBold(row, !!matched.incumbent, doc);
        if (matched.incumbent) stats.boldApplied++;
        setStrike(row, !!matched.suspended, doc);
        if (matched.suspended) stats.strikethroughApplied++;
        stats.candidatesUpdated++;
      }

      // Add new candidates
      const hasCloneSource = candidateRows.length > 0;
      for (let ci = 0; ci < candidates.length; ci++) {
        if (matchedDataIndices.has(ci)) continue;
        const cand = candidates[ci];
        const removalKey = `${distNum}|${chamber}|${normalizeName(cand.name).full}`;
        if (removalSet.has(removalKey)) continue;
        if (!hasCloneSource) { stats.warnings.push(`LD${distNum} ${chamber}: no clone source for ${cand.name}`); continue; }

        let sourceRow = null;
        for (const cr of candidateRows) { if (cr.parentNode === table) { sourceRow = cr; break; } }
        if (!sourceRow) {
          const currentRows = getTableRows(table);
          if (currentRows.length > 1) sourceRow = currentRows[currentRows.length - 1];
        }
        if (!sourceRow) continue;

        const newRow = sourceRow.cloneNode(true);
        const cells = getChildElements(newRow, 'tc', W_NS);
        const values = [cand.name, fmtVal(cand.financing), fmtVal(cand.income_total), fmtVal(cand.income_this_period), fmtVal(cand.expenses_total), fmtVal(cand.cash_balance)];
        for (let ci2 = 0; ci2 < Math.min(cells.length, values.length); ci2++) setCellText(cells[ci2], values[ci2], doc);

        setRowColor(newRow, partyColor(cand.party), doc);
        setBold(newRow, !!cand.incumbent, doc);
        if (cand.incumbent) stats.boldApplied++;
        setStrike(newRow, !!cand.suspended, doc);
        if (cand.suspended) stats.strikethroughApplied++;

        table.appendChild(newRow);
        stats.candidatesAdded++;
        stats.addedDetails.push(`${cand.name} (LD${distNum} ${chamber}, ${cand.party})`);
      }
    }
    stats.districtsProcessed++;
  }

  // Table layout fixes: cantSplit on all rows, tblHeader on first rows
  const allTables = doc.getElementsByTagNameNS(W_NS, 'tbl');
  let tablesFixed = 0;
  for (let t = 0; t < allTables.length; t++) {
    const tbl = allTables[t];
    const rows = getTableRows(tbl);
    for (const row of rows) {
      let trPr = getChildElements(row, 'trPr', W_NS)[0];
      if (!trPr) {
        trPr = doc.createElementNS(W_NS, 'w:trPr');
        row.insertBefore(trPr, row.firstChild);
      }
      if (getChildElements(trPr, 'cantSplit', W_NS).length === 0) {
        trPr.appendChild(doc.createElementNS(W_NS, 'w:cantSplit'));
      }
    }
    if (rows.length > 0) {
      let trPr = getChildElements(rows[0], 'trPr', W_NS)[0];
      if (!trPr) {
        trPr = doc.createElementNS(W_NS, 'w:trPr');
        rows[0].insertBefore(trPr, rows[0].firstChild);
      }
      if (getChildElements(trPr, 'tblHeader', W_NS).length === 0) {
        trPr.appendChild(doc.createElementNS(W_NS, 'w:tblHeader'));
      }
    }
    tablesFixed++;
  }

  // Minimize spacing on empty inter-table paragraphs
  let spacingFixed = 0;
  for (let i = 0; i < bodyChildren.length; i++) {
    if (bodyChildren[i].localName === 'p') {
      const prevIsTbl = i > 0 && bodyChildren[i - 1].localName === 'tbl';
      const nextIsTbl = i < bodyChildren.length - 1 && bodyChildren[i + 1].localName === 'tbl';
      if (prevIsTbl || nextIsTbl) {
        const text = getWordText(bodyChildren[i]).trim();
        if (text === '') {
          const pPrs = getChildElements(bodyChildren[i], 'pPr', W_NS);
          let pPr = pPrs[0];
          if (!pPr) {
            pPr = doc.createElementNS(W_NS, 'w:pPr');
            bodyChildren[i].insertBefore(pPr, bodyChildren[i].firstChild);
          }
          let spacing = getChildElements(pPr, 'spacing', W_NS)[0];
          if (!spacing) {
            spacing = doc.createElementNS(W_NS, 'w:spacing');
            pPr.appendChild(spacing);
          }
          spacing.setAttributeNS(W_NS, 'w:before', '0');
          spacing.setAttributeNS(W_NS, 'w:after', '0');
          spacing.setAttributeNS(W_NS, 'w:line', '240');
          spacingFixed++;
        }
      }
    }
  }
  console.log(`  Table layout: ${tablesFixed} tables fixed, ${spacingFixed} inter-table spacings minimized`);

  // Section breaks between districts: each district starts on a new page.
  // Uses "Different First Page" so only the first page of each district shows the header;
  // overflow pages (rare) get an empty header.
  //
  // 1. Create an empty header file for non-first pages
  // 2. Add a relationship for it
  // 3. Insert sectPr in the last paragraph before each district heading (districts 2-30)
  // 4. Update the body-level sectPr for district 30's section

  // Find the rId for the existing default header and figure out an unused rId
  const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  const relsDom = domParser.parseFromString(relsXml, 'application/xml');
  const rels = getElementsByLocalName(relsDom, 'Relationship');
  let headerRId = null;
  let maxRId = 0;
  for (const rel of rels) {
    const id = rel.getAttribute('Id') || '';
    const target = rel.getAttribute('Target') || '';
    const num = parseInt(id.replace(/\D/g, ''), 10);
    if (num > maxRId) maxRId = num;
    if (target === 'header1.xml') headerRId = id;
  }
  const emptyHeaderRId = `rId${maxRId + 1}`;

  // Create empty header2.xml
  const emptyHeaderXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p></w:hdr>';
  zip.file('word/header2.xml', emptyHeaderXml);

  // Add relationship for header2.xml
  const newRel = relsDom.createElement('Relationship');
  newRel.setAttribute('Id', emptyHeaderRId);
  newRel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header');
  newRel.setAttribute('Target', 'header2.xml');
  relsDom.documentElement.appendChild(newRel);
  const relsSerializer = new XMLSerializer();
  zip.file('word/_rels/document.xml.rels', relsSerializer.serializeToString(relsDom));

  // Also add header2.xml to [Content_Types].xml if not already present
  const ctXml = await zip.file('[Content_Types].xml').async('string');
  if (!ctXml.includes('header2.xml')) {
    const ctDom = domParser.parseFromString(ctXml, 'application/xml');
    const override = ctDom.createElement('Override');
    override.setAttribute('PartName', '/word/header2.xml');
    override.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml');
    ctDom.documentElement.appendChild(override);
    zip.file('[Content_Types].xml', relsSerializer.serializeToString(ctDom));
  }

  // Helper: build a sectPr element with "Different First Page"
  // Copy page layout from original body-level sectPr
  const bodySectPrs = getChildElements(body, 'sectPr', W_NS);
  const origSectPr = bodySectPrs.length > 0 ? bodySectPrs[bodySectPrs.length - 1] : null;

  function buildSectionBreak() {
    const sectPr = doc.createElementNS(W_NS, 'w:sectPr');
    // Header references: first page = real header, default (non-first) = empty
    const firstRef = doc.createElementNS(W_NS, 'w:headerReference');
    firstRef.setAttribute('w:type', 'first');
    firstRef.setAttribute('r:id', headerRId);
    sectPr.appendChild(firstRef);
    const defaultRef = doc.createElementNS(W_NS, 'w:headerReference');
    defaultRef.setAttribute('w:type', 'default');
    defaultRef.setAttribute('r:id', emptyHeaderRId);
    sectPr.appendChild(defaultRef);
    // Copy footer references from original
    if (origSectPr) {
      const footerRefs = getChildElements(origSectPr, 'footerReference', W_NS);
      for (const fr of footerRefs) sectPr.appendChild(fr.cloneNode(true));
    }
    // Enable "Different First Page"
    sectPr.appendChild(doc.createElementNS(W_NS, 'w:titlePg'));
    // Copy page layout
    if (origSectPr) {
      for (const tag of ['pgSz', 'pgMar', 'cols', 'docGrid']) {
        const els = getChildElements(origSectPr, tag, W_NS);
        if (els.length > 0) sectPr.appendChild(els[0].cloneNode(true));
      }
    }
    return sectPr;
  }

  // Insert section breaks by creating a dedicated empty paragraph with sectPr
  // immediately before each district heading. This avoids placing the break inside
  // a previous district's content (e.g., between its population tables).
  let sectionBreaksAdded = 0;
  for (let distNum = 2; distNum <= 30; distNum++) {
    const headingIdx = districtPositions.get(distNum);
    if (headingIdx === undefined) continue;
    const headingEl = bodyChildren[headingIdx];
    // Create a minimal empty paragraph with the section break
    const breakPara = doc.createElementNS(W_NS, 'w:p');
    const breakPPr = doc.createElementNS(W_NS, 'w:pPr');
    // Minimize the paragraph's height so it doesn't add visible blank space
    const spacing = doc.createElementNS(W_NS, 'w:spacing');
    spacing.setAttribute('w:before', '0');
    spacing.setAttribute('w:after', '0');
    spacing.setAttribute('w:line', '240');
    spacing.setAttribute('w:lineRule', 'auto');
    breakPPr.appendChild(spacing);
    breakPPr.appendChild(buildSectionBreak());
    breakPara.appendChild(breakPPr);
    // Insert immediately before the heading
    body.insertBefore(breakPara, headingEl);
    sectionBreaksAdded++;
  }

  // Remove trailing empty paragraphs before each section break to prevent blank pages.
  // The source template has spacer paragraphs at the end of each district that, combined
  // with the new section breaks, can push content to an extra page creating blank pages.
  // Also collapse consecutive empty paragraphs between tables to at most 1.
  {
    // Re-read body children after insertions
    const updatedChildren = [];
    for (let n = body.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1) updatedChildren.push(n);
    }

    function isEmptyPara(el) {
      if (el.localName !== 'p') return false;
      // Don't remove paragraphs that carry a section break
      const pPrs = el.getElementsByTagNameNS(W_NS, 'pPr');
      if (pPrs.length > 0 && pPrs[0].getElementsByTagNameNS(W_NS, 'sectPr').length > 0) return false;
      // Check for any text content
      const texts = el.getElementsByTagNameNS(W_NS, 't');
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].textContent.trim()) return false;
      }
      return true;
    }

    let removedTrailing = 0;
    // For each section break paragraph, remove empty paragraphs immediately before it
    for (const el of updatedChildren) {
      const pPrs = el.getElementsByTagNameNS(W_NS, 'pPr');
      const hasSectPr = pPrs.length > 0 && pPrs[0].getElementsByTagNameNS(W_NS, 'sectPr').length > 0;
      if (!hasSectPr) continue;

      // Walk backward from this section break, removing empty paragraphs
      let prev = el.previousSibling;
      while (prev) {
        // Skip text nodes
        if (prev.nodeType !== 1) { prev = prev.previousSibling; continue; }
        if (isEmptyPara(prev)) {
          const toRemove = prev;
          prev = prev.previousSibling;
          body.removeChild(toRemove);
          removedTrailing++;
        } else {
          break;
        }
      }
    }

    // Also remove trailing empty paragraphs at the very end of the document (after LD30)
    // but before the body-level sectPr
    const bodyLevelSectPrs = getChildElements(body, 'sectPr', W_NS);
    const bodySectPrEl = bodyLevelSectPrs.length > 0 ? bodyLevelSectPrs[bodyLevelSectPrs.length - 1] : null;
    if (bodySectPrEl) {
      let prev = bodySectPrEl.previousSibling;
      while (prev) {
        if (prev.nodeType !== 1) { prev = prev.previousSibling; continue; }
        if (isEmptyPara(prev)) {
          const toRemove = prev;
          prev = prev.previousSibling;
          body.removeChild(toRemove);
          removedTrailing++;
        } else {
          break;
        }
      }
    }

    // Collapse consecutive empty paragraphs between elements within each district to max 1
    let removedInner = 0;
    const refreshed = [];
    for (let n = body.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1) refreshed.push(n);
    }
    for (let i = 1; i < refreshed.length; i++) {
      if (isEmptyPara(refreshed[i]) && isEmptyPara(refreshed[i - 1])) {
        body.removeChild(refreshed[i]);
        removedInner++;
      }
    }

    console.log(`  Spacing cleanup: removed ${removedTrailing} trailing + ${removedInner} consecutive empty paragraphs`);
  }

  // Update the body-level sectPr for district 30's section (the last section)
  if (origSectPr) {
    // Add titlePg if not present
    if (getChildElements(origSectPr, 'titlePg', W_NS).length === 0) {
      origSectPr.appendChild(doc.createElementNS(W_NS, 'w:titlePg'));
    }
    // Update header references: change default to empty, add first = real
    const existingHeaderRefs = getChildElements(origSectPr, 'headerReference', W_NS);
    for (const hr of existingHeaderRefs) {
      if (hr.getAttribute('w:type') === 'default') {
        hr.setAttribute('r:id', emptyHeaderRId);
      }
    }
    // Add first-page header reference
    let hasFirst = false;
    for (const hr of getChildElements(origSectPr, 'headerReference', W_NS)) {
      if (hr.getAttribute('w:type') === 'first') { hasFirst = true; break; }
    }
    if (!hasFirst) {
      const firstRef = doc.createElementNS(W_NS, 'w:headerReference');
      firstRef.setAttribute('w:type', 'first');
      firstRef.setAttribute('r:id', headerRId);
      origSectPr.insertBefore(firstRef, origSectPr.firstChild);
    }
  }
  console.log(`  Section breaks: ${sectionBreaksAdded} added (districts 2-30, first-page headers only)`);

  // Validate
  const serializer = new XMLSerializer();
  const outputXml = serializer.serializeToString(doc);
  const verifyDoc = domParser.parseFromString(outputXml, 'application/xml');
  const parseErrors = getElementsByLocalName(verifyDoc, 'parsererror');
  if (parseErrors.length > 0) { console.error('ERROR: Output XML is not well-formed!'); process.exit(1); }

  let distCount = 0;
  const vParagraphs = verifyDoc.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < vParagraphs.length; i++) {
    if (/^Legislative\s+District\s+\d+$/i.test(getWordText(vParagraphs[i]).trim())) distCount++;
  }
  if (distCount < 30) { console.error(`ERROR: Only ${distCount}/30 district headings in output!`); process.exit(1); }

  // Write
  zip.file('word/document.xml', outputXml);
  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, outputBuffer);

  const deltaBytes = outputBuffer.length - docxBuffer.length;
  const deltaPct = ((deltaBytes / docxBuffer.length) * 100).toFixed(1);
  console.log(`  Districts: ${stats.districtsProcessed}/30, Updated: ${stats.candidatesUpdated}, Added: ${stats.candidatesAdded}, Removed: ${stats.candidatesRemoved}`);
  if (stats.addedDetails.length > 0) stats.addedDetails.forEach(d => console.log(`    + ${d}`));
  if (stats.removedDetails.length > 0) stats.removedDetails.forEach(d => console.log(`    - ${d}`));
  console.log(`  Bold: ${stats.boldApplied}, Strikethrough: ${stats.strikethroughApplied}`);
  console.log(`  Output: ${Math.round(outputBuffer.length / 1024)}KB (original: ${Math.round(docxBuffer.length / 1024)}KB, ${deltaBytes >= 0 ? '+' : ''}${deltaPct}%)`);
  console.log(`  Validation: PASS`);
  if (stats.warnings.length > 0) {
    console.log(`  Warnings (${stats.warnings.length}):`);
    stats.warnings.forEach(w => console.log(`    - ${w}`));
  }
}

// ===========================================================================
// Build output JSON
// ===========================================================================
function buildOutput(candidates, invalidCandidates, flags) {
  const districts = {};
  for (const c of candidates) {
    const d = String(c.district);
    if (!districts[d]) districts[d] = {};
    if (!districts[d][c.chamber]) districts[d][c.chamber] = [];
    districts[d][c.chamber].push({
      name: c.name, party: c.party, incumbent: c.incumbent || false, suspended: c.suspended || false,
      entity_status: c._entityStatus || null, financing: c.financing || '-', entity_id: c.entity_id || null,
      pdf_url: c.pdf_url || null, pdf_filename: c.pdf_filename || null, filing_date: c.filing_date || null,
      cash_balance: c.cash_balance || null, income_this_period: c.income_this_period || null,
      income_total: c.income_total || null, expenses_total: c.expenses_total || null,
      low_confidence_fields: c.low_confidence_fields || [],
    });
  }
  for (const c of invalidCandidates) {
    flags.push({ type: 'parse_error', candidate_name: c.name, office: c.office, detail: 'Could not determine chamber or district' });
  }
  const today = new Date();
  return { run_date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, districts, flags };
}

// ===========================================================================
// CLI Mode: --review-flags
// ===========================================================================
function reviewFlags(dataPath) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const flags = data.flags || [];
  if (flags.length === 0) { console.log('No flags to review.'); return; }

  // Group by type
  const groups = {};
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (!groups[f.type]) groups[f.type] = [];
    groups[f.type].push({ index: i, flag: f });
  }

  const FLAG_TYPE_ORDER = ['fuzzy_incumbent_match', 'fuzzy_entity_match', 'suspended_nonincumbent', 'multiple_active', 'no_match', 'no_active', 'pipeline_error', 'parse_error'];
  const sortedTypes = FLAG_TYPE_ORDER.filter(t => groups[t]).concat(Object.keys(groups).filter(t => !FLAG_TYPE_ORDER.includes(t)));

  console.log(`\n=== Flag Review (${flags.length} flags) ===\n`);

  for (const type of sortedTypes) {
    const items = groups[type];
    const typeLabel = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    console.log(`--- ${typeLabel} (${items.length}) ---`);

    for (const { index, flag } of items) {
      const color = flag.party ? ` [${flag.party}]` : '';
      const district = flag.district ? ` D${flag.district}` : '';
      const chamber = flag.chamber ? ` ${flag.chamber}` : '';
      const loc = `${district}${chamber}`.trim();

      const cached = flag._cached ? ' (cached)' : '';
      let detail = '';
      if (type === 'fuzzy_incumbent_match') {
        const status = flag.auto_set ? 'AUTO-SET' : 'NOT SET';
        const decision = flag.rejected ? ' -> REJECTED' : flag.confirmed ? ' -> CONFIRMED' : '';
        detail = `  [${index}] ${flag.candidate_name}${color} (${loc}) — matched "${flag.roster_name}" via ${flag.match_method} (${status})${decision}${cached}`;
      } else if (type === 'fuzzy_entity_match') {
        const dist = flag.distance !== undefined ? `, distance=${flag.distance}` : '';
        const decision = flag.confirmed ? ' -> CONFIRMED' : flag.rejected ? ' -> REJECTED' : '';
        detail = `  [${index}] ${flag.candidate_name}${color} (${loc}) — matched "${flag.entity_name || flag.potential_entity_name}" [${flag.potential_entity_id}] via ${flag.match_method}${dist}${decision}${cached}`;
      } else if (type === 'suspended_nonincumbent') {
        const decision = flag.approved !== undefined ? (flag.approved ? ' -> KEEP' : ' -> REMOVE') : '';
        detail = `  [${index}] ${flag.candidate_name}${color} (${loc})${decision}${cached}`;
      } else if (type === 'multiple_active') {
        const chosenSuffix = flag.chosen_entity_id ? ` -> chosen: ${flag.chosen_entity_id}${cached}` : '';
        detail = `  [${index}] ${flag.candidate_name}${color} (${loc}) — entities: ${(flag.entity_ids || []).join(', ')}${chosenSuffix}`;
      } else if (type === 'no_match' || type === 'no_active') {
        detail = `  [${index}] ${flag.candidate_name}${color} (${loc})`;
      } else if (type === 'pipeline_error') {
        detail = `  [${index}] ${flag.candidate_name} (${loc}) — ${flag.status}: ${flag.error || ''}`;
      } else {
        detail = `  [${index}] ${JSON.stringify(flag)}`;
      }
      console.log(detail);
    }
    console.log('');
  }

  // Summary of pending decisions
  const pending = flags.filter(f => {
    if (f.type === 'fuzzy_incumbent_match') return !f.rejected && !f.confirmed;
    if (f.type === 'fuzzy_entity_match') return !f.confirmed && !f.rejected;
    if (f.type === 'suspended_nonincumbent') return f.approved === undefined;
    if (f.type === 'multiple_active') return !f.chosen_entity_id;
    return false;
  });
  if (pending.length > 0) {
    console.log(`${pending.length} flag(s) still need decisions.`);
  } else {
    console.log('All actionable flags have decisions. Ready for --resume.');
  }
}

// ===========================================================================
// CLI Mode: --apply-flag / --apply-flags
// ===========================================================================
function applyFlagSingle(dataPath, index, action) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const flags = data.flags || [];
  if (index < 0 || index >= flags.length) {
    console.error(`Flag index ${index} out of range (0–${flags.length - 1})`);
    process.exit(1);
  }
  const flag = flags[index];
  applyDecision(flag, action, data);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  updateFlagCache(flags);
  console.log(`Applied "${action}" to flag [${index}] (${flag.type}: ${flag.candidate_name})`);
}

function applyFlagsBatch(dataPath, decisionsPath) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const flags = data.flags || [];
  const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));

  if (!Array.isArray(decisions)) {
    console.error('Decisions file must contain a JSON array of {index, action} objects');
    process.exit(1);
  }

  let applied = 0;
  for (const { index, action } of decisions) {
    if (index < 0 || index >= flags.length) {
      console.error(`  Skipping: flag index ${index} out of range (0–${flags.length - 1})`);
      continue;
    }
    const flag = flags[index];
    applyDecision(flag, action, data);
    console.log(`  [${index}] ${flag.type}: ${flag.candidate_name} -> ${action}`);
    applied++;
  }

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  updateFlagCache(flags);
  console.log(`\nApplied ${applied}/${decisions.length} decisions. Data written to: ${dataPath}`);
}

function applyDecision(flag, action, data) {
  const act = (action || '').toLowerCase();
  if (act !== 'confirm' && act !== 'reject') {
    console.error(`Invalid action "${action}" — must be "confirm" or "reject"`);
    process.exit(1);
  }
  switch (flag.type) {
    case 'fuzzy_incumbent_match':
      if (act === 'confirm') { flag.confirmed = true; delete flag.rejected; }
      else { flag.rejected = true; delete flag.confirmed; }
      // Also update candidate data directly so the data file stays consistent
      if (data) {
        const dist = data.districts[String(flag.district)];
        if (dist) {
          const candidates = dist[flag.chamber] || [];
          const candNorm = normalizeName(flag.candidate_name).full;
          const cand = candidates.find(c => normalizeName(c.name).full === candNorm);
          if (cand) {
            if (flag.auto_set && act === 'reject') cand.incumbent = false;
            else if (!flag.auto_set && act === 'confirm') cand.incumbent = true;
          }
        }
      }
      break;
    case 'fuzzy_entity_match':
      if (act === 'confirm') { flag.confirmed = true; delete flag.rejected; }
      else { flag.rejected = true; delete flag.confirmed; }
      break;
    case 'suspended_nonincumbent':
      // confirm = approve keeping them (approved: true), reject = remove them (approved: false)
      flag.approved = (act === 'confirm');
      break;
    case 'multiple_active':
      // For multiple_active, confirm/reject doesn't quite fit — user should set chosen_entity_id directly
      // But we handle it gracefully: reject = leave unresolved, confirm = no-op (needs entity id)
      if (act === 'reject') { flag.rejected = true; }
      else { console.warn(`  Warning: multiple_active flags need a chosen_entity_id — use direct JSON edit`); }
      break;
    default:
      console.warn(`  Warning: flag type "${flag.type}" is informational — decision stored but may have no effect`);
      if (act === 'confirm') flag.confirmed = true;
      else flag.rejected = true;
      break;
  }
}

// ===========================================================================
// CLI Mode: --verify
// ===========================================================================
async function verifyDocx(dataPath, docxPath, count) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const docxBuffer = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(docxBuffer);

  // Parse document.xml and all header files
  const domParser = new DOMParser();
  const docXmlText = await zip.file('word/document.xml').async('string');
  const doc = domParser.parseFromString(docXmlText, 'application/xml');

  const headerTexts = [];
  for (const filename of Object.keys(zip.files)) {
    if (/^word\/header\d+\.xml$/.test(filename)) {
      const headerXml = await zip.file(filename).async('string');
      const headerDoc = domParser.parseFromString(headerXml, 'application/xml');
      headerTexts.push({ filename, doc: headerDoc });
    }
  }

  // Build candidate pool: only those with cash_balance !== '-'
  const pool = [];
  for (const [dist, chambers] of Object.entries(data.districts || {})) {
    for (const [chamber, candidates] of Object.entries(chambers)) {
      for (const c of candidates) {
        if (c.cash_balance && c.cash_balance !== '-') {
          pool.push({ ...c, district: dist, chamber });
        }
      }
    }
  }

  if (pool.length === 0) {
    console.log('No candidates with finance data to verify.');
    return;
  }

  // Pick random sample
  const sampleSize = Math.min(count, pool.length);
  const sample = [];
  const used = new Set();
  while (sample.length < sampleSize) {
    const idx = Math.floor(Math.random() * pool.length);
    if (!used.has(idx)) { used.add(idx); sample.push(pool[idx]); }
  }

  console.log(`\n=== Verification: ${sampleSize} candidates from ${docxPath} ===\n`);

  // Get all tables from document
  const allTables = doc.getElementsByTagNameNS(W_NS, 'tbl');
  let passed = 0;
  let failed = 0;

  for (const cand of sample) {
    const checks = [];
    const candNorm = normalizeName(cand.name).full;
    const expectedColor = partyColor(cand.party);

    // Find the candidate's row in docx
    let foundRow = null;
    for (let t = 0; t < allTables.length; t++) {
      const rows = getTableRows(allTables[t]);
      for (const row of rows) {
        const cellText = getCellText(row);
        if (normalizeName(cellText).full === candNorm) {
          foundRow = row;
          break;
        }
      }
      if (foundRow) break;
    }

    if (!foundRow) {
      console.log(`  FAIL: ${cand.name} (D${cand.district} ${cand.chamber}) — NOT FOUND in docx`);
      failed++;
      continue;
    }

    // Check 1: Name present
    checks.push({ label: 'Name found', pass: true });

    // Check 2: Finance values — get all cell texts from the row
    const cells = getChildElements(foundRow, 'tc', W_NS);
    const cellTexts = cells.map(c => getWordText(c).trim());

    const financeFields = [
      { field: 'cash_balance', label: 'Cash Balance' },
      { field: 'income_this_period', label: 'Income (Period)' },
      { field: 'income_total', label: 'Income (Total)' },
      { field: 'expenses_total', label: 'Expenses (Total)' },
    ];
    for (const { field, label } of financeFields) {
      const expected = fmtVal(cand[field]);
      const found = cellTexts.some(t => t === expected);
      checks.push({ label: `${label}: "${expected}"`, pass: found });
    }

    // Check 3: Color — only check run-level rPr (skip pPr/rPr paragraph defaults)
    const runEls = getElementsByLocalName(foundRow, 'r').filter(r => r.namespaceURI === W_NS || !r.namespaceURI);
    let foundColor = null;
    for (const run of runEls) {
      const rPr = getChildElements(run, 'rPr', W_NS)[0];
      if (!rPr) continue;
      const colorEls = getChildElements(rPr, 'color', W_NS);
      if (colorEls.length > 0) {
        const el = colorEls[0];
        foundColor = el.getAttributeNS(W_NS, 'val')
          || el.getAttribute('w:val')
          || el.getAttribute('val');
        if (foundColor) break;
      }
    }
    // Normalize: strip leading '#', uppercase both sides
    const normFound = foundColor ? foundColor.replace(/^#/, '').toUpperCase() : null;
    const normExpected = expectedColor ? expectedColor.replace(/^#/, '').toUpperCase() : null;
    checks.push({ label: `Color: ${normExpected} (found: ${normFound || 'null'})`, pass: normFound && normFound === normExpected });

    // Check 4: Bold iff incumbent — only check run-level rPr (skip pPr/rPr paragraph defaults)
    const hasBold = runEls.some(run => {
      const rPr = getChildElements(run, 'rPr', W_NS)[0];
      return rPr && getChildElements(rPr, 'b', W_NS).length > 0;
    });
    checks.push({ label: `Bold=${cand.incumbent}`, pass: hasBold === (cand.incumbent || false) });

    // Check 5: Strikethrough iff suspended — only check run-level rPr
    const hasStrike = runEls.some(run => {
      const rPr = getChildElements(run, 'rPr', W_NS)[0];
      return rPr && getChildElements(rPr, 'strike', W_NS).length > 0;
    });
    checks.push({ label: `Strike=${cand.suspended}`, pass: hasStrike === (cand.suspended || false) });

    const allPass = checks.every(c => c.pass);
    const status = allPass ? 'PASS' : 'FAIL';
    if (allPass) passed++; else failed++;

    console.log(`  ${status}: ${cand.name} (D${cand.district} ${cand.chamber}, ${cand.party})`);
    for (const c of checks) {
      if (!c.pass) console.log(`         x ${c.label}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${sampleSize} checked`);

  // Also check Last Edited date
  let foundLastEdited = false;
  const allParas = doc.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < allParas.length; i++) {
    const text = getWordText(allParas[i]);
    if (text.includes('Last Edited')) { foundLastEdited = true; console.log(`\nLast Edited (document.xml): "${text.trim()}"`); break; }
  }
  for (const h of headerTexts) {
    const hParas = h.doc.getElementsByTagNameNS(W_NS, 'p');
    for (let i = 0; i < hParas.length; i++) {
      const text = getWordText(hParas[i]);
      if (text.includes('Last Edited')) { foundLastEdited = true; console.log(`Last Edited (${h.filename}): "${text.trim()}"`); break; }
    }
  }
  if (!foundLastEdited) console.log('\nWARNING: "Last Edited" field not found in document or headers');
}

// ===========================================================================
// Main
// ===========================================================================
async function main() {
  const opts = parseArgs();

  // Utility modes — no pipeline run
  if (opts.reviewFlags) {
    reviewFlags(opts.data);
    return;
  }
  if (opts.applyFlag !== undefined) {
    applyFlagSingle(opts.data, opts.applyFlag, opts.action);
    return;
  }
  if (opts.applyFlags) {
    applyFlagsBatch(opts.data, opts.applyFlags);
    return;
  }
  if (opts.verify) {
    const count = parseInt(opts.count || '5', 10);
    await verifyDocx(opts.data, opts.verifyDocx, count);
    return;
  }

  console.log('=== Elections Notebook Pipeline ===');
  console.log(`Mode: ${opts.resume ? 'RESUME (Phase C only)' : opts.pauseForFlags ? 'PAUSE-FOR-FLAGS (Phases A+B)' : 'FULL (Phases A+B+C)'}`);

  if (opts.resume) {
    console.log(`\n[Phase C] Updating docx... (${elapsed()})`);
    await updateDocx(opts.data, opts.notebook, opts.output);
    console.log(`\nDone. Total time: ${elapsed()}`);
    return;
  }

  // === Phase A: Bulk Setup ===
  console.log(`\n[Phase A] Bulk setup... (${elapsed()})`);

  const rawCandidates = JSON.parse(fs.readFileSync(opts.candidates, 'utf8'));
  const flags = [];
  const { candidates, invalidCandidates } = parseCandidates(rawCandidates);

  console.log('  Fetching rosters...');
  const roster = await fetchRosters();

  console.log('  Fetching finance entities...');
  const entities = await fetchFinanceEntities(flags);

  console.log('  Matching candidates to entities...');
  await matchCandidates(candidates, entities, flags);

  console.log('  Detecting incumbents...');
  detectIncumbents(candidates, roster, flags);

  console.log(`  Phase A complete. (${elapsed()})`);

  // === Phase B: Per-Candidate Pipeline ===
  const candidatesWithEntities = candidates.filter(c => c.entity_id);
  console.log(`\n[Phase B] Processing ${candidatesWithEntities.length} candidates (${POOL_SIZE} concurrent)... (${elapsed()})`);

  const pdfDir = opts['pdf-dir'] || config.pdf_dir;
  let completedCount = 0;
  const statusCounts = { ok: 0, no_entity: 0, no_report: 0, api_error: 0, download_error: 0, extraction_error: 0, extraction_partial: 0, other: 0 };

  await batchParallel(candidates, POOL_SIZE, BATCH_DELAY, async (candidate, idx, total) => {
    const result = await processCandidate(candidate, pdfDir);
    completedCount++;

    if (result.status === 'ok') statusCounts.ok++;
    else if (result.status === 'no_entity') statusCounts.no_entity++;
    else if (result.status === 'no_report') statusCounts.no_report++;
    else if (result.status === 'extraction_partial') statusCounts.extraction_partial++;
    else if (result.status.includes('error')) {
      statusCounts.other++;
      flags.push({ type: 'pipeline_error', candidate_name: candidate.name, district: candidate.district, chamber: candidate.chamber, status: result.status, error: result.error || result.errors, pdf_url: candidate.pdf_url || null, entity_id: candidate.entity_id || null });
    }

    if (completedCount % 10 === 0 || completedCount === total) {
      const pct = Math.round((completedCount / total) * 100);
      const bar = '\u2588'.repeat(Math.floor(pct / 10)) + '\u2591'.repeat(10 - Math.floor(pct / 10));
      process.stdout.write(`\r  [${String(completedCount).padStart(4)}/${total}] ${bar} ${String(pct).padStart(3)}%`);
    }
  });

  console.log('');
  console.log(`  Results: ${statusCounts.ok} extracted, ${statusCounts.no_report} no report, ${statusCounts.no_entity} no entity, ${statusCounts.extraction_partial} partial, ${statusCounts.other} errors`);

  // Create suspended_nonincumbent flags now that entity status is known
  const suspendedCount = candidates.filter(c => c.suspended).length;
  for (const candidate of candidates) {
    if (candidate.suspended && !candidate.incumbent) {
      flags.push({
        type: 'suspended_nonincumbent',
        candidate_name: candidate.name,
        district: candidate.district,
        chamber: candidate.chamber,
      });
    }
  }
  if (suspendedCount > 0) console.log(`  Suspended/terminated: ${suspendedCount} candidate(s)`);

  console.log(`  Phase B complete. (${elapsed()})`);

  // Write elections_data.json
  const output = buildOutput(candidates, invalidCandidates, flags);
  const dataDir = path.dirname(opts.data);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(opts.data, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n  Data written to: ${opts.data}`);

  // Apply cached flag decisions
  const cachedCount = applyCachedDecisions(flags, output);
  if (cachedCount > 0) {
    // Re-save with cached decisions applied
    fs.writeFileSync(opts.data, JSON.stringify(buildOutput(candidates, invalidCandidates, flags), null, 2), 'utf8');
    console.log(`  Auto-applied ${cachedCount} cached flag decision(s)`);
  }

  // Flag summary
  if (flags.length > 0) {
    const typeCounts = {};
    const pendingCounts = {};
    for (const f of flags) {
      typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
      if (!f._cached && !f.approved !== undefined) pendingCounts[f.type] = (pendingCounts[f.type] || 0) + 1;
    }
    console.log(`\n  Flags (${flags.length}):`);
    for (const [type, count] of Object.entries(typeCounts)) console.log(`    ${type}: ${count}`);
  }

  if (opts.pauseForFlags && flags.length > 0) {
    console.log(`\n  Pausing for flag review. Re-run with --resume after editing elections_data.json.`);
    console.log(`  Total time (Phases A+B): ${elapsed()}`);
    return;
  }

  if (opts.pauseForFlags && flags.length === 0) {
    console.log(`\n  No flags to review.`);
  }

  // === Phase C: Docx Update ===
  console.log(`\n[Phase C] Updating docx... (${elapsed()})`);
  await updateDocx(opts.data, opts.notebook, opts.output);

  console.log(`\nDone. Total time: ${elapsed()}`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
