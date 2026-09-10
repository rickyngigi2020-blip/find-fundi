import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'temporary screenshots');
fs.mkdirSync(outDir, { recursive: true });

const url = process.argv[2];
const label = process.argv[3];

if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label]');
  process.exit(1);
}

let n = 1;
while (fs.existsSync(path.join(outDir, `screenshot-${n}${label ? '-' + label : ''}.png`))) n++;
const outFile = path.join(outDir, `screenshot-${n}${label ? '-' + label : ''}.png`);

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 900 });
await page.goto(url, { waitUntil: 'networkidle0' });

// force scroll-triggered reveal animations into their end state instead of
// physically scrolling — scrolling a sticky-positioned header before a
// fullPage capture can leave a ghost copy stuck mid-page in the stitched image
await page.evaluate(() => {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  document.querySelectorAll('.route-path').forEach((el) => el.classList.add('in'));
});
await new Promise((r) => setTimeout(r, 150));

await page.screenshot({ path: outFile, fullPage: true });
await browser.close();

console.log(`Saved ${outFile}`);
