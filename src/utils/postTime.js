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
      // Prioritize shorter
