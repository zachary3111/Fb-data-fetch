let ocrWorker = null; // reused across posts

/**
 * Extract an ISO timestamp for a Facebook post.
 * 1) DOM datetime
 * 2) DOM text/title/aria parsed
 * 3) Optional OCR fallback (slow)
 */
export async function extractPostDateISO(page, opts = {}) {
  const { enableOcr = false } = opts;

  const found = await page.evaluate(() => {
    const scope = document.querySelector('[role="article"]') || document;
    const timeEls = Array.from(scope.querySelectorAll('time, a, span'));
    const candidates = [];
    for (const el of timeEls) {
      const dt = el.getAttribute('datetime'); if (dt) candidates.push({ kind: 'datetime', value: dt });
      const title = el.getAttribute('title'); if (title) candidates.push({ kind: 'title', value: title });
      const aria = el.getAttribute('aria-label'); if (aria) candidates.push({ kind: 'aria', value: aria });
      const text = (el.textContent || '').trim(); if (text) candidates.push({ kind: 'text', value: text });
    }
    return candidates.slice(0, 80);
  });

  for (const c of found) if (c.kind === 'datetime') { const iso = normalizeToISO(c.value); if (iso) return { iso, source: 'dom_datetime' }; }
  for (const c of found) if (c.kind !== 'datetime') { const iso = parseLooseDate(c.value); if (iso) return { iso, source: 'dom_' + c.kind }; }

  if (enableOcr) {
    try {
      const clip = await locateHeaderBox(page);
      const buf = await page.screenshot({ clip, type: 'png' });
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(buf);
      const text = (data?.text || '').replace(/\s+/g, ' ').trim();
      const iso = parseLooseDate(text);
      if (iso) return { iso, source: 'ocr' };
    } catch {}
  }
  return null;
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  const { createWorker } = await import('tesseract.js');
  ocrWorker = await createWorker({ logger: null });
  await ocrWorker.loadLanguage('eng');
  await ocrWorker.initialize('eng');
  return ocrWorker;
}

export async function disposeOcr() { try { if (ocrWorker) await ocrWorker.terminate(); } finally { ocrWorker = null; } }

function normalizeToISO(v) { try { const d = new Date(v); if (!isFinite(d.getTime())) return null; return d.toISOString(); } catch { return null; } }

/**
 * Parse FB-like date strings to ISO (UTC via toISOString).
 */
export function parseLooseDate(text, opts = {}) {
  if (!text) return null;
  const now = opts.now instanceof Date ? new Date(opts.now.getTime()) : new Date();

  const cleaned = String(text).trim();
  const lower = cleaned.toLowerCase();

  if (/(^|\b)just\s*now(\b|$)/i.test(cleaned)) return toISO(now);

  const rel = lower.match(/(\d{1,3})\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2][0];
    const dt = new Date(now);
    if (unit === 'm') dt.setMinutes(dt.getMinutes() - n);
    else if (unit === 'h') dt.setHours(dt.getHours() - n);
    else if (unit === 'd') dt.setDate(dt.getDate() - n);
    return toISO(dt);
  }

  const y1 = cleaned.match(/Yesterday\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (y1) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - 1);
    let h = parseInt(y1[1], 10);
    const m = parseInt(y1[2], 10);
    const ampm = y1[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    dt.setHours(h, m, 0, 0);
    return toISO(dt);
  }

  const md = cleaned.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (md) {
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const month = monthNames.findIndex((m) => m.toLowerCase() === md[1].toLowerCase());
    const day = parseInt(md[2], 10);
    let h = parseInt(md[3], 10);
    const m = parseInt(md[4], 10);
    const ampm = md[5].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    const dt = new Date(now);
    dt.setMonth(month, day);
    dt.setHours(h, m, 0, 0);
    return toISO(dt);
  }

  const dt = new Date(cleaned);
  if (isFinite(dt.getTime())) return toISO(dt);
  return null;
}

function toISO(d) { return new Date(d.getTime()).toISOString(); }

export async function locateHeaderBox(page) {
  const rect = await page.evaluate(() => {
    const el = document.querySelector('[role="article"]') || document.querySelector('div[aria-posinset]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: Math.min(r.width, 800), height: Math.min(r.height, 220) };
  });
  return rect || { x: 0, y: 0, width: 900, height: 240 };
}