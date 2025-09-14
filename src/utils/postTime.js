let ocrWorker = null; // reused across posts

/**
 * Extract an ISO timestamp for a Facebook post.
 * Returns { iso, raw, source } format to match sample output
 */
export async function extractPostDateISO(page, opts = {}) {
  const { enableOcr = false } = opts;

  console.log('Starting post time extraction...');

  // Enhanced time extraction with more comprehensive selectors
  const found = await page.evaluate(() => {
    const scope = document.querySelector('[role="article"]') || document;
    const candidates = [];
    
    console.log('Looking for time elements in scope...');
    
    // Strategy 1: Look for time elements with datetime attributes (most reliable)
    const timeElements = scope.querySelectorAll('time[datetime]');
    console.log(`Found ${timeElements.length} time elements with datetime`);
    for (const el of timeElements) {
      const dt = el.getAttribute('datetime');
      if (dt) {
        candidates.push({ 
          kind: 'datetime', 
          value: dt, 
          element: 'time[datetime]',
          text: el.textContent?.trim() || ''
        });
      }
    }
    
    // Strategy 2: Look for elements with aria-label containing time info
    const ariaElements = scope.querySelectorAll('[aria-label*="ago"], [aria-label*="at"], [aria-label*="Published"], [aria-label*="Posted"]');
    console.log(`Found ${ariaElements.length} elements with time-related aria-labels`);
    for (const el of ariaElements) {
      const aria = el.getAttribute('aria-label');
      if (aria && isTimeText(aria)) {
        candidates.push({ 
          kind: 'aria', 
          value: aria, 
          element: 'aria-label',
          text: el.textContent?.trim() || ''
        });
      }
    }
    
    // Strategy 3: Look for title attributes with time info
    const titleElements = scope.querySelectorAll('[title]');
    console.log(`Found ${titleElements.length} elements with title attributes`);
    for (const el of titleElements) {
      const title = el.getAttribute('title');
      if (title && isTimeText(title)) {
        candidates.push({ 
          kind: 'title', 
          value: title, 
          element: 'title',
          text: el.textContent?.trim() || ''
        });
      }
    }
    
    // Strategy 4: Enhanced text content search
    const allElements = scope.querySelectorAll('*');
    console.log(`Scanning ${allElements.length} elements for time text...`);
    let textElementCount = 0;
    
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      const directText = (el.childNodes[0]?.nodeType === 3 ? el.childNodes[0].textContent : '').trim();
      
      // Check direct text content
      if (directText && isTimeText(directText) && directText.length < 100) {
        candidates.push({ 
          kind: 'text', 
          value: directText, 
          element: el.tagName.toLowerCase(),
          text: directText
        });
        textElementCount++;
      }
      
      // Check full text content for short elements
      if (text && text !== directText && isTimeText(text) && text.length < 50) {
        candidates.push({ 
          kind: 'text', 
          value: text, 
          element: el.tagName.toLowerCase(),
          text: text
        });
        textElementCount++;
      }
      
      if (textElementCount > 20) break; // Prevent excessive searching
    }
    
    console.log(`Found ${candidates.length} time candidates`);
    
    // Helper function to identify time-like text with more patterns
    function isTimeText(text) {
      if (!text || typeof text !== 'string') return false;
      
      const cleaned = text.trim().toLowerCase();
      
      const timePatterns = [
        // Relative time formats
        /^\d+\s*[smhd]$/i,                                    // 3d, 2h, 45m, 30s
        /^\d+\s+(second|minute|hour|day|week|month|year)s?(\s+ago)?$/i,
        /^(just\s*now|yesterday|today)$/i,
        /^\d+\s*[smhd]\s*$/i,                               // "3 d", "2h "
        
        // Specific date formats
        /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+/i,
        /^yesterday\s+at\s+\d+:\d+/i,
        /^\d{1,2}:\d{2}\s*(am|pm)?$/i,                      // Time formats
        /^\d{1,2}\/\d{1,2}\/\d{2,4}/i,                     // Date formats
        /^\d{4}-\d{2}-\d{2}/i,                             // ISO date format
        
        // Facebook-specific patterns
        /\d+\s*(minutes?|hours?|days?|weeks?|months?|years?)\s*ago/i,
        /published\s*on/i,
        /posted\s*on/i,
        /shared\s*on/i,
        /at\s*\d{1,2}:\d{2}/i,                             // "at 3:45"
        
        // Time ago patterns
        /\b\d+[smhd]\b/i,
        /\b(a|an)\s+(second|minute|hour|day|week|month|year)\s+ago/i,
        
        // Specific Facebook time formats
        /\b(last\s+week|this\s+week|last\s+month|this\s+month)\b/i
      ];
      
      const hasTimePattern = timePatterns.some(pattern => pattern.test(cleaned));
      const isReasonableLength = cleaned.length >= 1 && cleaned.length <= 100;
      const notUIText = !/(^(like|comment|share|see\s+more|home|watch|marketplace)$)/i.test(cleaned);
      
      return hasTimePattern && isReasonableLength && notUIText;
    }
    
    return candidates.slice(0, 50); // Limit to prevent excessive data
  });

  console.log(`Found ${found.length} time candidates:`, found.slice(0, 5).map(c => ({
    kind: c.kind,
    value: c.value?.substring(0, 50),
    element: c.element
  })));

  // Try datetime attributes first (most reliable)
  for (const c of found) {
    if (c.kind === 'datetime') { 
      const iso = normalizeToISO(c.value); 
      if (iso) {
        console.log('Found valid datetime:', c.value, '=>', iso);
        return { 
          iso, 
          raw: c.text || c.value, 
          source: 'dom-datetime' 
        }; 
      }
    }
  }
  
  // Try aria-label attributes (common for Facebook time elements)
  for (const c of found) {
    if (c.kind === 'aria') { 
      const iso = parseLooseDate(c.value); 
      if (iso) {
        console.log('Found valid aria time:', c.value, '=>', iso);
        return { 
          iso, 
          raw: c.text || c.value, 
          source: 'dom-aria' 
        }; 
      }
    }
  }
  
  // Try title attributes
  for (const c of found) {
    if (c.kind === 'title') { 
      const iso = parseLooseDate(c.value); 
      if (iso) {
        console.log('Found valid title time:', c.value, '=>', iso);
        return { 
          iso, 
          raw: c.text || c.value, 
          source: 'dom-title' 
        }; 
      }
    }
  }
  
  // Try text content - sort by likelihood (shorter, more specific text first)
  const textCandidates = found
    .filter(c => c.kind === 'text')
    .sort((a, b) => {
      // Prioritize shorter text and more specific patterns
      const aLen = a.value?.length || 0;
      const bLen = b.value?.length || 0;
      const aSpecific = /^\d+[smhd]$/.test(a.value) ? 1 : 0;
      const bSpecific = /^\d+[smhd]$/.test(b.value) ? 1 : 0;
      
      if (aSpecific !== bSpecific) return bSpecific - aSpecific;
      return aLen - bLen;
    });
  
  for (const c of textCandidates) {
    const iso = parseLooseDate(c.value); 
    if (iso) {
      console.log('Found valid text time:', c.value, '=>', iso);
      return { 
        iso, 
        raw: c.text || c.value, 
        source: 'dom-text' 
      }; 
    }
  }

  // Fallback: Enhanced page scan for time patterns
  console.log('Trying fallback page scan...');
  const fallbackResult = await page.evaluate(() => {
    const bodyText = document.body.innerText || '';
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    
    // Look for standalone time patterns in the text
    const timeRegexes = [
      /\b\d+[smhd]\b/g,                                   // 3d, 2h, etc.
      /\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi,
      /\b(yesterday|today)\s+at\s+\d{1,2}:\d{2}\s*(am|pm)?\b/gi,
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s*(am|pm)?\b/gi,
      /\bjust\s+now\b/gi
    ];
    
    for (const line of lines) {
      if (line.length > 200) continue; // Skip very long lines
      
      for (const regex of timeRegexes) {
        const matches = line.match(regex);
        if (matches) {
          for (const match of matches) {
            const trimmed = match.trim();
            if (trimmed.length <= 50 && trimmed.length >= 2) {
              return trimmed;
            }
          }
        }
      }
    }
    
    return null;
  });
  
  if (fallbackResult) {
    const iso = parseLooseDate(fallbackResult);
    if (iso) {
      console.log('Found valid fallback time:', fallbackResult, '=>', iso);
      return {
        iso,
        raw: fallbackResult,
        source: 'fallback-scan'
      };
    }
  }

  if (enableOcr) {
    console.log('Attempting OCR extraction...');
    try {
      const clip = await locateHeaderBox(page);
      const buf = await page.screenshot({ clip, type: 'png' });
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(buf);
      const text = (data?.text || '').replace(/\s+/g, ' ').trim();
      const iso = parseLooseDate(text);
      if (iso) {
        console.log('Found valid OCR time:', text, '=>', iso);
        return { 
          iso, 
          raw: text, 
          source: 'ocr' 
        };
      }
    } catch (e) {
      console.log('OCR extraction failed:', e.message);
    }
  }
  
  console.log('No valid time information found');
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

  // Handle relative time formats: "3d", "2h", "45m", "30s" - Enhanced with more flexibility
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

  // Handle standalone relative time like "3d" without "ago"
  const standaloneMatch = lower.match(/^(\d{1,3})\s*([smhd])$/);
  if (standaloneMatch) {
    const n = parseInt(standaloneMatch[1], 10);
    const unit = standaloneMatch[2];
    const dt = new Date(now);
    
    if (unit === 's') dt.setSeconds(dt.getSeconds() - n);
    else if (unit === 'm') dt.setMinutes(dt.getMinutes() - n);
    else if (unit === 'h') dt.setHours(dt.getHours() - n);
    else if (unit === 'd') dt.setDate(dt.getDate() - n);
    
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
