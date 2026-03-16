// collect-data.js — Collects candidate rosters, finance entities, and report data
// Usage: node collect-data.js --candidates <path-to-json> --output <path-for-output>
//
// Replaces the LLM subagent data-collection step. Fetches candidate rosters from
// azleg.gov, finance entity data from seethemoney.az.gov, matches candidates to
// entities, detects incumbents, fetches report lists, and writes elections_data.json.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const API_DELAY = config.api_delay_ms || 200;
const CYCLE_YEAR = config.election_cycle_year || 2026;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, body, headers: res.headers });
      });
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
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const respBody = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, body: respBody, headers: res.headers });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Normalize a name for comparison: lowercase, strip suffixes, strip middle initials.
 * Returns { full, last, firstInitial, first }
 */
function normalizeName(raw) {
  let name = raw.trim().toLowerCase();
  // Strip suffixes
  name = name.replace(/\b(jr\.?|sr\.?|ii|iii|iv)\s*$/i, '').trim();
  // Remove extra spaces
  name = name.replace(/\s+/g, ' ');

  const parts = name.split(' ');
  const first = parts[0] || '';
  const firstInitial = first.charAt(0);

  // Last name is the final part; middle initials are anything between first and last
  // Strip single-letter middle initials
  const filtered = parts.filter((p, i) => {
    if (i === 0) return true; // first name
    if (i === parts.length - 1) return true; // last name
    return p.length > 1; // keep multi-char middle names, drop initials
  });

  const last = filtered[filtered.length - 1] || '';
  const full = filtered.join(' ');

  return { full, last, firstInitial, first, raw: raw.trim() };
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--candidates' && args[i + 1]) {
      result.candidates = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      result.output = args[++i];
    }
  }
  if (!result.candidates || !result.output) {
    console.error('Usage: node collect-data.js --candidates <path> --output <path>');
    process.exit(1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// [1/6] Parse candidates
// ---------------------------------------------------------------------------

function parseCandidates(rawCandidates) {
  console.log('\n[1/6] Parsing candidates...');
  const candidates = rawCandidates.map((c) => {
    let chamber = null;
    if (/representative/i.test(c.office)) chamber = 'house';
    else if (/senator/i.test(c.office) || /senate/i.test(c.office)) chamber = 'senate';

    const distMatch = c.office.match(/district\s*(?:no\.?\s*)?(\d+)/i);
    const district = distMatch ? parseInt(distMatch[1], 10) : null;

    const suspended = /suspended|terminated/i.test(c.campaignInfo || '');

    return {
      name: c.name.trim(),
      party: c.party,
      chamber,
      district,
      suspended,
      filedDate: c.filedDate || null,
      office: c.office,
    };
  });

  const valid = candidates.filter(c => c.chamber && c.district);
  const invalid = candidates.filter(c => !c.chamber || !c.district);

  // Deduplicate by name+district+chamber, keeping the most recent filedDate
  const deduped = [];
  const seen = new Map();
  for (const c of valid) {
    const key = `${c.name.toLowerCase()}|${c.district}|${c.chamber}`;
    if (seen.has(key)) {
      const existing = deduped[seen.get(key)];
      const existingDate = existing.filedDate ? new Date(existing.filedDate) : new Date(0);
      const newDate = c.filedDate ? new Date(c.filedDate) : new Date(0);
      if (newDate > existingDate) {
        deduped[seen.get(key)] = c;
      }
    } else {
      seen.set(key, deduped.length);
      deduped.push(c);
    }
  }

  const dupCount = valid.length - deduped.length;
  console.log(`  Parsed ${deduped.length} candidates (${invalid.length} unparseable, ${dupCount} duplicates removed)`);
  if (invalid.length > 0) {
    invalid.forEach(c => console.log(`    WARN: Could not parse office: "${c.office}" for ${c.name}`));
  }

  return { candidates: deduped, invalidCandidates: invalid };
}

// ---------------------------------------------------------------------------
// [2/6] Fetch rosters from azleg.gov
// ---------------------------------------------------------------------------

async function fetchRosters() {
  console.log('\n[2/6] Fetching legislative rosters from azleg.gov...');
  const roster = {}; // key: "{district}_{chamber}" → [name, ...]

  for (const [chamber, url] of [['house', config.roster_house_url], ['senate', config.roster_senate_url]]) {
    console.log(`  Fetching ${chamber} roster...`);
    try {
      const res = await httpGet(url);
      if (res.statusCode !== 200) {
        console.log(`    WARN: HTTP ${res.statusCode} fetching ${chamber} roster`);
        continue;
      }
      const $ = cheerio.load(res.body);

      // azleg.gov roster page has a table with member rows
      // Look for table rows with member names and districts
      let memberCount = 0;

      // Try multiple selector strategies
      $('table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;

        // Try to find name and district from table cells
        const text = $(row).text();
        const distMatch = text.match(/\b(\d{1,2})\b/);
        if (!distMatch) return;
        const dist = parseInt(distMatch[1], 10);
        if (dist < 1 || dist > 30) return;

        // Look for a link with the member name
        const nameLink = $(row).find('a');
        let memberName = null;
        nameLink.each((_, el) => {
          const href = $(el).attr('href') || '';
          const linkText = $(el).text().trim();
          if ((href.includes('Member') || href.includes('member')) && linkText.length > 2) {
            memberName = linkText;
          }
        });

        // Fallback: first cell text if it looks like a name
        if (!memberName) {
          const firstCell = $(cells[0]).text().trim();
          if (firstCell.length > 2 && /[a-zA-Z]/.test(firstCell) && !/^\d+$/.test(firstCell)) {
            memberName = firstCell;
          }
        }

        if (memberName && dist) {
          const key = `${dist}_${chamber}`;
          if (!roster[key]) roster[key] = [];
          // Avoid duplicates
          if (!roster[key].includes(memberName)) {
            roster[key].push(memberName);
            memberCount++;
          }
        }
      });

      // Alternative parse strategy if table approach found nothing
      if (memberCount === 0) {
        // Some azleg pages use div-based layouts
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href.includes('Member') && !href.includes('member')) return;
          const name = $(el).text().trim();
          if (name.length < 3) return;

          // Try to find district in surrounding context
          const parent = $(el).closest('tr, div, li');
          const parentText = parent.text();
          const dm = parentText.match(/\b(\d{1,2})\b/);
          if (!dm) return;
          const d = parseInt(dm[1], 10);
          if (d < 1 || d > 30) return;

          const key = `${d}_${chamber}`;
          if (!roster[key]) roster[key] = [];
          if (!roster[key].includes(name)) {
            roster[key].push(name);
            memberCount++;
          }
        });
      }

      console.log(`    Found ${memberCount} ${chamber} members`);
    } catch (err) {
      console.log(`    ERROR fetching ${chamber} roster: ${err.message}`);
    }

    await sleep(API_DELAY);
  }

  return roster;
}

// ---------------------------------------------------------------------------
// [3/6] Fetch finance entities from seethemoney.az.gov
// ---------------------------------------------------------------------------

async function fetchFinanceEntities(flags) {
  console.log('\n[3/6] Fetching finance entities from seethemoney.az.gov...');

  const postBody = 'draw=1&start=0&length=5000&order[0][column]=0&order[0][dir]=asc&search[value]=&search[regex]=false';
  const contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
  const entities = new Map(); // EntityID → entity object

  for (const [label, isLessActive] of [['active', 'false'], ['less_active', 'true']]) {
    const url = `${config.finance_api_url}?Page=1&startYear=2025&endYear=${CYCLE_YEAR}&JurisdictionId=0&TablePage=1&TableLength=5000&IsLessActive=${isLessActive}&ShowOfficeHolder=false&ChartName=1`;

    console.log(`  Fetching ${label} entities...`);
    try {
      const res = await httpPost(url, postBody, contentType);
      if (res.statusCode !== 200) {
        console.log(`    WARN: HTTP ${res.statusCode} for ${label} entities`);
        flags.push({
          type: 'api_error',
          detail: `Finance API returned HTTP ${res.statusCode} for ${label} entities`,
          url,
        });
        continue;
      }

      let json;
      try {
        json = JSON.parse(res.body);
      } catch (e) {
        console.log(`    WARN: Invalid JSON response for ${label} entities`);
        flags.push({
          type: 'api_error',
          detail: `Finance API returned invalid JSON for ${label} entities`,
          url,
          response_snippet: res.body.substring(0, 200),
        });
        continue;
      }

      const data = json.data || [];
      console.log(`    Received ${data.length} ${label} entities`);

      for (const entity of data) {
        const eid = entity.EntityID;
        if (!eid) continue;
        // Keep active-list version if duplicate
        if (entities.has(eid) && label === 'less_active') continue;
        entities.set(eid, { ...entity, source: label === 'active' ? 'active' : 'less_active' });
      }
    } catch (err) {
      console.log(`    ERROR fetching ${label} entities: ${err.message}`);
      flags.push({
        type: 'api_error',
        detail: `Failed to fetch ${label} entities: ${err.message}`,
        url,
      });
    }

    await sleep(API_DELAY);
  }

  console.log(`  Total unique entities: ${entities.size}`);
  return entities;
}

// ---------------------------------------------------------------------------
// [4/6] Match candidates to finance entities
// ---------------------------------------------------------------------------

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

function determineFinancing(entityTypeName) {
  if (!entityTypeName) return '-';
  const lower = entityTypeName.toLowerCase();
  if (lower.includes('clean elections') || lower.includes('participating')) return 'Public';
  return 'Private';
}

async function fetchEntityStatus(entityId) {
  const url = `https://seethemoney.az.gov/Reporting/Details/${entityId}`;
  try {
    const res = await httpGet(url);
    if (res.statusCode !== 200) return null;
    const $ = cheerio.load(res.body);

    // Look for "Status:" in Demographic Information section
    let status = null;
    $('th, td, dt, dd, label, span, div').each((_, el) => {
      const text = $(el).text().trim();
      if (/^status\s*:/i.test(text)) {
        // Status value might be in the same element or a sibling
        const val = text.replace(/^status\s*:\s*/i, '').trim();
        if (val) {
          status = val;
          return false;
        }
        // Check next sibling
        const next = $(el).next();
        if (next.length) {
          status = next.text().trim();
          return false;
        }
      }
    });

    // Also try looking for a key-value table pattern
    if (!status) {
      $('tr').each((_, row) => {
        const cells = $(row).find('td, th');
        cells.each((i, cell) => {
          if (/^status$/i.test($(cell).text().trim()) && cells[i + 1]) {
            status = $(cells[i + 1]).text().trim();
            return false;
          }
        });
        if (status) return false;
      });
    }

    return status;
  } catch (err) {
    return null;
  }
}

async function matchCandidates(candidates, entities, flags) {
  console.log('\n[4/6] Matching candidates to finance entities...');

  // Index entities by normalized last name + district + chamber for faster lookup
  const entityIndex = new Map(); // key: "lastname_district_chamber" → [entity, ...]
  for (const [eid, entity] of entities) {
    const { chamber, district } = parseOfficeName(entity.OfficeName);
    if (!chamber || !district) continue;

    const lastName = (entity.EntityLastName || '').trim();
    const norm = normalizeName(lastName);
    const key = `${norm.last}_${district}_${chamber}`;
    if (!entityIndex.has(key)) entityIndex.set(key, []);
    entityIndex.get(key).push({ ...entity, _parsedChamber: chamber, _parsedDistrict: district });
  }

  let matchCount = 0;
  let noMatchCount = 0;

  for (const candidate of candidates) {
    const candNorm = normalizeName(candidate.name);
    const key = `${candNorm.last}_${candidate.district}_${candidate.chamber}`;
    const matches = entityIndex.get(key) || [];

    if (matches.length === 0) {
      // No match found
      candidate.entity_id = null;
      candidate.financing = '-';
      candidate.matchStatus = 'no_match';
      noMatchCount++;
      flags.push({
        type: 'no_match',
        candidate_name: candidate.name,
        district: candidate.district,
        chamber: candidate.chamber,
        party: candidate.party,
      });
      continue;
    }

    if (matches.length === 1) {
      // Single match
      const m = matches[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = determineFinancing(m.EntityTypeName);
      candidate.entityName = `${m.EntityLastName}`.trim();
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'matched';
      candidate._entitySource = m.source;
      matchCount++;
      continue;
    }

    // Multiple matches — disambiguate by checking status
    console.log(`    Disambiguating ${candidate.name} (${matches.length} matches)...`);
    let activeMatches = [];
    for (const m of matches) {
      await sleep(API_DELAY);
      const status = await fetchEntityStatus(m.EntityID);
      if (status && /active/i.test(status) && !/inactive|not active/i.test(status)) {
        activeMatches.push({ ...m, _status: status });
      }
    }

    if (activeMatches.length === 1) {
      const m = activeMatches[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = determineFinancing(m.EntityTypeName);
      candidate.entityName = `${m.EntityLastName}`.trim();
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'matched';
      candidate._entitySource = m.source;
      matchCount++;
    } else if (activeMatches.length === 0) {
      // None active — use first match but flag
      const m = matches[0];
      candidate.entity_id = m.EntityID;
      candidate.financing = determineFinancing(m.EntityTypeName);
      candidate.entityName = `${m.EntityLastName}`.trim();
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'no_active';
      flags.push({
        type: 'no_active',
        candidate_name: candidate.name,
        district: candidate.district,
        chamber: candidate.chamber,
        entity_ids: matches.map(m => m.EntityID),
      });
      matchCount++;
    } else {
      // Still ambiguous
      const m = activeMatches[0]; // Use first active but flag
      candidate.entity_id = m.EntityID;
      candidate.financing = determineFinancing(m.EntityTypeName);
      candidate.entityName = `${m.EntityLastName}`.trim();
      candidate.committeeName = m.CommitteeName || null;
      candidate.matchStatus = 'multiple_active';
      flags.push({
        type: 'multiple_active',
        candidate_name: candidate.name,
        district: candidate.district,
        chamber: candidate.chamber,
        entity_ids: activeMatches.map(m => m.EntityID),
        detail: `${activeMatches.length} active entities found — used first`,
      });
      matchCount++;
    }
  }

  console.log(`  Matched: ${matchCount}, Unmatched: ${noMatchCount}`);
  return candidates;
}

// ---------------------------------------------------------------------------
// [5/6] Detect incumbents
// ---------------------------------------------------------------------------

function detectIncumbents(candidates, roster, flags) {
  console.log('\n[5/6] Detecting incumbents...');

  let exactCount = 0;
  let fuzzyCount = 0;

  for (const candidate of candidates) {
    const key = `${candidate.district}_${candidate.chamber}`;
    const rosterNames = roster[key] || [];
    if (rosterNames.length === 0) {
      candidate.incumbent = false;
      continue;
    }

    const candNorm = normalizeName(candidate.name);

    // Pass 1: Exact match (case-insensitive full name)
    let matched = false;
    for (const rName of rosterNames) {
      const rNorm = normalizeName(rName);
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

    for (const rName of rosterNames) {
      const rNorm = normalizeName(rName);

      // Last name match + first initial match
      if (candNorm.last === rNorm.last && candNorm.firstInitial === rNorm.firstInitial) {
        fuzzyMatch = rName;
        matchMethod = 'first_initial_and_last_name';
        break;
      }

      // Last name match only
      if (candNorm.last === rNorm.last) {
        fuzzyMatch = rName;
        matchMethod = 'last_name_only';
        break;
      }

      // Substring containment (candidate name contains roster name or vice versa)
      if (candNorm.full.includes(rNorm.full) || rNorm.full.includes(candNorm.full)) {
        fuzzyMatch = rName;
        matchMethod = 'substring_containment';
        break;
      }
    }

    if (fuzzyMatch) {
      fuzzyCount++;
      flags.push({
        type: 'fuzzy_incumbent_match',
        candidate_name: candidate.name,
        roster_name: fuzzyMatch,
        district: candidate.district,
        chamber: candidate.chamber,
        match_method: matchMethod,
      });
      candidate.incumbent = true;
    } else {
      candidate.incumbent = false;
    }
  }

  // Handle suspended status interactions
  for (const candidate of candidates) {
    if (candidate.suspended && candidate.incumbent) {
      // incumbent + suspended is valid — keep both flags
    } else if (candidate.suspended && !candidate.incumbent) {
      flags.push({
        type: 'suspended_nonincumbent',
        candidate_name: candidate.name,
        district: candidate.district,
        chamber: candidate.chamber,
      });
    }
  }

  console.log(`  Exact incumbent matches: ${exactCount}`);
  console.log(`  Fuzzy incumbent matches: ${fuzzyCount}`);
  console.log(`  Non-incumbents: ${candidates.filter(c => !c.incumbent).length}`);
}

// ---------------------------------------------------------------------------
// [6/6] Fetch report lists
// ---------------------------------------------------------------------------

async function fetchReports(candidates, flags) {
  console.log('\n[6/6] Fetching campaign finance reports...');

  const matchedCandidates = candidates.filter(c => c.entity_id);
  const total = matchedCandidates.length;
  let idx = 0;

  for (const candidate of candidates) {
    if (!candidate.entity_id) {
      candidate.pdf_url = null;
      candidate.pdf_filename = null;
      candidate.filing_date = null;
      continue;
    }

    idx++;
    const nameParts = candidate.name.split(' ');
    const last = nameParts[nameParts.length - 1];
    const first = nameParts[0];
    console.log(`  [${idx}/${total}] ${last}, ${first} (LD${candidate.district} ${candidate.chamber})...`);

    const url = `${config.reports_api_url}?Name=1~${candidate.entity_id}&ChartName=11&ShowAllYears=true`;

    try {
      const res = await httpGet(url);
      if (res.statusCode !== 200) {
        console.log(`    WARN: HTTP ${res.statusCode}`);
        candidate.pdf_url = null;
        candidate.pdf_filename = null;
        candidate.filing_date = null;
        flags.push({
          type: 'api_error',
          detail: `Reports API returned HTTP ${res.statusCode}`,
          candidate_name: candidate.name,
          entity_id: candidate.entity_id,
        });
        await sleep(API_DELAY);
        continue;
      }

      let json;
      try {
        json = JSON.parse(res.body);
      } catch (e) {
        console.log(`    WARN: Invalid JSON`);
        candidate.pdf_url = null;
        candidate.pdf_filename = null;
        candidate.filing_date = null;
        flags.push({
          type: 'api_error',
          detail: 'Reports API returned invalid JSON',
          candidate_name: candidate.name,
          entity_id: candidate.entity_id,
          response_snippet: res.body.substring(0, 200),
        });
        await sleep(API_DELAY);
        continue;
      }

      // json could be an array or have a data property
      const reports = Array.isArray(json) ? json : (json.data || json.aaData || []);

      // Filter to current election cycle
      const cycleReports = reports.filter(r => {
        const cy = r.CycleYear || r.cycleYear;
        return cy == CYCLE_YEAR;
      });

      if (cycleReports.length === 0) {
        candidate.pdf_url = null;
        candidate.pdf_filename = null;
        candidate.filing_date = null;
        // financing stays as already determined
        await sleep(API_DELAY);
        continue;
      }

      // Sort by FilingDate descending to get most recent
      cycleReports.sort((a, b) => {
        const da = new Date(a.FilingDate || a.filingDate || 0);
        const db = new Date(b.FilingDate || b.filingDate || 0);
        return db - da;
      });

      const latest = cycleReports[0];
      const reportUrl = latest.ReportFileURL || latest.reportFileURL || latest.ReportFileUrl || null;
      const filingDate = latest.FilingDate || latest.filingDate || null;

      // Format filing date
      let filingDateStr = null;
      if (filingDate) {
        const d = new Date(filingDate);
        if (!isNaN(d)) {
          filingDateStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
        } else {
          filingDateStr = filingDate;
        }
      }

      // Build PDF filename: "{Last}, {First} - {MM-DD-YY}.pdf"
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
    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      candidate.pdf_url = null;
      candidate.pdf_filename = null;
      candidate.filing_date = null;
      flags.push({
        type: 'api_error',
        detail: `Failed to fetch reports: ${err.message}`,
        candidate_name: candidate.name,
        entity_id: candidate.entity_id,
      });
    }

    await sleep(API_DELAY);
  }
}

// ---------------------------------------------------------------------------
// Build output
// ---------------------------------------------------------------------------

function buildOutput(candidates, invalidCandidates, flags) {
  const districts = {};

  for (const c of candidates) {
    const d = String(c.district);
    if (!districts[d]) districts[d] = {};
    if (!districts[d][c.chamber]) districts[d][c.chamber] = [];

    districts[d][c.chamber].push({
      name: c.name,
      party: c.party,
      incumbent: c.incumbent || false,
      suspended: c.suspended || false,
      financing: c.financing || '-',
      entity_id: c.entity_id || null,
      pdf_url: c.pdf_url || null,
      pdf_filename: c.pdf_filename || null,
      filing_date: c.filing_date || null,
      cash_balance: null,
      income_this_period: null,
      income_total: null,
      expenses_total: null,
      low_confidence_fields: [],
    });
  }

  // Add flags for invalid candidates so they are not silently dropped
  for (const c of invalidCandidates) {
    flags.push({
      type: 'parse_error',
      candidate_name: c.name,
      office: c.office,
      detail: 'Could not determine chamber or district from office text',
    });
  }

  const today = new Date();
  const runDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return {
    run_date: runDate,
    districts,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  console.log('=== Elections Notebook Data Collection ===');
  console.log(`Candidates file: ${args.candidates}`);
  console.log(`Output file: ${args.output}`);
  console.log(`Election cycle: ${CYCLE_YEAR}`);

  // Read input candidates
  let rawCandidates;
  try {
    rawCandidates = JSON.parse(fs.readFileSync(args.candidates, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Could not read candidates file: ${err.message}`);
    process.exit(1);
  }

  const flags = [];

  // [1/6] Parse candidates
  const { candidates, invalidCandidates } = parseCandidates(rawCandidates);

  // [2/6] Fetch rosters
  const roster = await fetchRosters();

  // [3/6] Fetch finance entities
  const entities = await fetchFinanceEntities(flags);

  // [4/6] Match candidates to finance entities
  await matchCandidates(candidates, entities, flags);

  // [5/6] Detect incumbents
  detectIncumbents(candidates, roster, flags);

  // [6/6] Fetch report lists
  await fetchReports(candidates, flags);

  // Build and write output
  const output = buildOutput(candidates, invalidCandidates, flags);

  // Ensure output directory exists
  const outDir = path.dirname(args.output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(args.output, JSON.stringify(output, null, 2), 'utf8');

  // Summary
  const totalCandidates = candidates.length;
  const matched = candidates.filter(c => c.entity_id).length;
  const incumbents = candidates.filter(c => c.incumbent).length;
  const withReports = candidates.filter(c => c.pdf_url).length;
  const districtCount = Object.keys(output.districts).length;

  console.log('\n=== Summary ===');
  console.log(`  Candidates: ${totalCandidates}`);
  console.log(`  Districts: ${districtCount}`);
  console.log(`  Matched to finance entity: ${matched}`);
  console.log(`  Incumbents detected: ${incumbents}`);
  console.log(`  With finance reports: ${withReports}`);
  console.log(`  Flags: ${flags.length}`);
  console.log(`\nOutput written to: ${args.output}`);

  if (flags.length > 0) {
    console.log('\nFlags:');
    const typeCounts = {};
    for (const f of flags) {
      typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  ${type}: ${count}`);
    }
  }
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
