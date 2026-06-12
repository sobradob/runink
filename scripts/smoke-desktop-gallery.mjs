import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const dist = path.resolve('dist-demo');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const data = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    const html = await readFile(path.join(dist, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  }
});
await new Promise(r => server.listen(4181, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4181/');
await page.waitForSelector('text=Los Angeles - Base', { timeout: 15000 });
await page.click('text=Los Angeles - Base');
await page.waitForSelector('[aria-label^="Theme:"]:visible', { timeout: 15000 });
await page.waitForTimeout(4500);
await page.screenshot({ path: '/tmp/theme-gallery-desktop.png' });
await browser.close();
server.close();
