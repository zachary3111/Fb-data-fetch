let ocrWorker = null; // reused across posts

/**
 * Extract an ISO timestamp for a Facebook post.
 * Returns { iso, raw, source } format to match sample output
 */
export async function extractPostDateISO(page, opts = {}) {
  const { enableOcr = false } = opts;

  const found = await page.evaluate(() => {
    const scope = document.querySelector('[role="article"]') || document;
    const timeEls = Array.from(scope.querySelectorAll('time, a, span, div'));
    const candidates = [];
    
    for (const el of timeEls) {
      const dt = el.getAttribute('datetime'); 
      if (dt) candidates.push({ kind: 'datetime', value: dt, element: 'datetime' });
      
      const title = el.getAttribute('title'); 
      if (title) candidates.push({ kind: 'title', value: title, element: 'title' });
      
      const aria = el.getAttribute('aria-label'); 
      if (aria) candidates.push({ kind: 'aria', value: aria, element: 'aria-label' });
      
      const text = (el.textContent || '').trim(); 
      if (text && isTimeText(text)) {
        candidates.push({ kind: 'text', value: text, element: 'text' });
      }
    }
    
    // Helper function to identify time-like text
    function isTimeText(text) {
      const timePatterns = [
        /^\d+[smhd]$/i,                    // 3d, 2h, 45m, 30s
        /^\d+\s+(second|minute|hour|day|week|month|year)s?(\s+ago)?$/i,
        /^(just\s+now|yesterday|today)$/i,
        /^\d+\s*[smhd]\s*$/i,             // "3 d", "2h "
        /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+/i,
        /^yesterday\s+at\s+\d+:\d+/i,
        /^\d{1,2}:\d{2}\s*(am|pm)?$/i     // Time formats
      ];
      
      return timePatterns.some(pattern => pattern.test(text.trim())) && text.length < 50;
    }
    
    return candidates.slice(0, 80);
  });

  // Try datetime attributes first (most reliable)
  for (const c of found) {
    if (c.kind === 'datetime') { 
      const iso = normalizeToISO(c.value); 
      if (iso) return { 
        iso, 
        raw: c.value, 
        source: 'dom-datetime' 
      }; 
    }
  }
  
  // Try aria-label attributes (common for Facebook time elements)
  for (const c of found) {
    if (c.kind === 'aria') { 
      const iso = parseLooseDate(c.value); 
      if (iso) return { 
        iso, 
        raw: c.value, 
        source: 'dom-aria' 
      }; 
    }
  }
  
  // Try title attributes
  for (const c of found) {
    if (c.kind === 'title') { 
      const iso = parseLooseDate(c.value); 
      if (iso) return { 
        iso, 
        raw: c.value, 
        source: 'dom-title' 
      }; 
    }
  }
  
  // Try text content
  for (const c of found) {
    if (c.kind === 'text') { 
      const iso = parseLooseDate(c.value); 
      if (iso) return { 
        iso, 
        raw: c.value, 
        source: 'dom-text' 
      }; 
    }
  }

  if (enableOcr) {
    try {
      const clip = await locateHeaderBox(page);
      const buf = await page.screenshot({ clip, type: 'png' });
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(buf);
      const text = (data?.text || '').replace(/\s+/g, ' ').trim();
      const iso = parseLooseDate(text);
      if (iso) return { 
        iso, 
        raw: text, 
        source: 'ocr' 
      };
    } catch (e) {
      console.log('OCR extraction failed:', e.message);
    }
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

export async function disposeOcr() { 
  try { 
    if (ocrWorker) await ocrWorker.terminate(); 
  } finally { 
    ocrWorker = null; 
  } 
}

function normalizeToISO(v) { 
  try { 
    const d = new Date(v); 
    if (!isFinite(d.getTime())) return null; 
    return d.toISOString(); 
  } catch { 
    return null; 
  } 
}

/**
 * Parse Facebook-style relative dates to ISO timestamps.
 * Enhanced to handle more formats and provide better accuracy.
 */
export function parseLooseDate(text, opts = {}) {
  if (!text) return null;
  const now = opts.now instanceof Date ? new Date(opts.now.getTime()) : new Date();

  const cleaned = String(text).trim();
  const lower = cleaned.toLowerCase();

  // Handle "just now"
  if (/(^|\b)just\s*now(\b|$)/i.test(cleaned)) return toISO(now);

  // Handle relative time formats: "3d", "2h", "45m", "30s"
  const relativeMatch = lower.match(/(\d{1,3})\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)(\s+ago)?/i);
  if (relativeMatch) {
    const n = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const dt = new Date(now);
    
    if (unit.startsWith('s')) dt.setSeconds(dt.getSeconds() - n);
    else if (unit.startsWith('m')) dt.setMinutes(dt.getMinutes() - n);
    else if (unit.startsWith('h')) dt.setHours(dt.getHours() - n);
    else if (unit.startsWith('d')) dt.setDate(dt.getDate() - n);
    else if (unit.startsWith('w')) dt.setDate(dt.getDate() - (n * 7));
    else if (unit.startsWith('mo')) dt.setMonth(dt.getMonth() - n);
    else if (unit.startsWith('y')) dt.setFullYear(dt.getFullYear() - n);
    
    return toISO(dt);
  }

  // Handle "Yesterday at HH:MM AM/PM"
  const yesterdayMatch = cleaned.match(/yesterday\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (yesterdayMatch) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - 1);
    let h = parseInt(yesterdayMatch[1], 10);
    const m = parseInt(yesterdayMatch[2], 10);
    const ampm = yesterdayMatch[3].toLowerCase();
    
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    
    dt.setHours(h, m, 0, 0);
    return toISO(dt);
  }

  // Handle "Month DD at HH:MM AM/PM"
  const monthDateMatch = cleaned.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (monthDateMatch) {
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const month = monthNames.findIndex((m) => m === monthDateMatch[1].toLowerCase());
    const day = parseInt(monthDateMatch[2], 10);
    let h = parseInt(monthDateMatch[3], 10);
    const m = parseInt(monthDateMatch[4], 10);
    const ampm = monthDateMatch[5].toLowerCase();
    
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    
    const dt = new Date(now);
    dt.setMonth(month, day);
    dt.setHours(h, m, 0, 0);
    
    // Handle year boundary (if month/day is in future, assume previous year)
    if (dt > now) {
      dt.setFullYear(dt.getFullYear() - 1);
    }
    
    return toISO(dt);
  }

  // Handle "Month DD, YYYY at HH:MM AM/PM"
  const fullDateMatch = cleaned.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (fullDateMatch) {
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const month = monthNames.findIndex((m) => m === fullDateMatch[1].toLowerCase());
    const day = parseInt(fullDateMatch[2], 10);
    const year = parseInt(fullDateMatch[3], 10);
    let h = parseInt(fullDateMatch[4], 10);
    const m = parseInt(fullDateMatch[5], 10);
    const ampm = fullDateMatch[6].toLowerCase();
    
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    
    const dt = new Date(year, month, day, h, m, 0, 0);
    return toISO(dt);
  }

  // Try standard Date parsing as fallback
  const dt = new Date(cleaned);
  if (isFinite(dt.getTime())) return toISO(dt);
  
  return null;
}

function toISO(d) { 
  return new Date(d.getTime()).toISOString(); 
}

export async function locateHeaderBox(page) {
  const rect = await page.evaluate(() => {
    const el = document.querySelector('[role="article"]') || document.querySelector('div[aria-posinset]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: Math.min(r.width, 800), height: Math.min(r.height, 220) };
  });
  return rect || { x: 0, y: 0, width: 900, height: 240 };
}
