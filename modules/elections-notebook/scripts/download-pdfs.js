// download-pdfs.js — Downloads campaign finance PDFs from seethemoney.az.gov
// Usage: node download-pdfs.js
//
// Reads elections_data.json, downloads all PDFs with non-null pdf_url to
// Campaign Finance PDFs/LD{N}/ folders. Skips files that already exist.

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE = '~/Desktop/Elections Notebook/elections_data.json';
const PDF_BASE_DIR = '~/Desktop/Elections Notebook/Campaign Finance PDFs';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const DELAY_MS = 300;

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    }).on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  // Build download list
  const pdfs = [];
  for (const [dist, chambers] of Object.entries(data.districts)) {
    for (const [chamber, candidates] of Object.entries(chambers)) {
      for (const c of candidates) {
        if (c.pdf_url && c.pdf_filename) {
          pdfs.push({
            dir: 'LD' + dist,
            name: c.pdf_filename,
            url: c.pdf_url,
            candidate: c.name
          });
        }
      }
    }
  }

  console.log('Total PDFs to download: ' + pdfs.length);

  let downloaded = 0, skipped = 0, failed = 0;

  for (const pdf of pdfs) {
    const outDir = path.join(PDF_BASE_DIR, pdf.dir);
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, pdf.name);

    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    try {
      await downloadFile(pdf.url, dest);
      downloaded++;
      await sleep(DELAY_MS);
    } catch (err) {
      console.log(`FAIL ${pdf.dir}/${pdf.name} (${pdf.candidate}): ${err.message}`);
      failed++;
    }
  }

  console.log(`Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
