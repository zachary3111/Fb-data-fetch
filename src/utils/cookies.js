/**
 * Parse cookies input from JSON, header string, or Netscape format.
 */
export function parseCookiesInput(input, urlForDomain = "https://www.facebook.com/") {
  if (!input || typeof input !== "string") return [];
  const trimmed = input.trim();

  // Try JSON first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return normalizeCookieArray(parsed, urlForDomain);
    if (parsed && Array.isArray(parsed.cookies)) return normalizeCookieArray(parsed.cookies, urlForDomain);
    // Handle single cookie object
    if (parsed && parsed.name && parsed.value) return normalizeCookieArray([parsed], urlForDomain);
  } catch (_) {}

  // Check for Netscape cookie file format
  if (trimmed.includes('# Netscape HTTP Cookie File') || trimmed.includes('.facebook.com\t')) {
    return parseNetscapeCookies(trimmed, urlForDomain);
  }

  // Cookie header string: "key=value; key2=value2"
  const out = [];
  for (const pair of trimmed.split(/;\s*/)) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) continue;

    // Skip header attributes from Set-Cookie pasted by users
    if (/^(path|domain|expires|samesite|secure|httponly)$/i.test(name)) continue;

    out.push({ name, value: safeDecode(value), domain: extractDomain(urlForDomain), path: "/" });
  }
  return out;
}

/**
 * Parse Netscape format cookies (exported from browsers)
 */
function parseNetscapeCookies(text, urlForDomain) {
  const lines = text.split('\n');
  const cookies = [];
  const domain = extractDomain(urlForDomain);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('\t');
    if (parts.length >= 6) {
      const [cookieDomain, , path, secure, expires, name, ...valueParts] = parts;
      const value = valueParts.join('\t'); // Handle values with tabs

      // Only include Facebook cookies
      if (cookieDomain.includes('facebook.com')) {
        cookies.push({
          name: name,
          value: value,
          domain: cookieDomain.startsWith('.') ? cookieDomain : '.' + cookieDomain,
          path: path || '/',
          secure: secure === 'TRUE',
          expires: expires && expires !== '0' ? parseInt(expires) * 1000 : undefined
        });
      }
    }
  }

  return normalizeCookieArray(cookies, urlForDomain);
}

function safeDecode(v) { try { return decodeURIComponent(v); } catch { return v; } }

function normalizeCookieArray(arr, urlForDomain) {
  const domain = extractDomain(urlForDomain);
  const mapSameSite = (s) => {
    const v = String(s || "Lax").toLowerCase();
    if (v.startsWith("l")) return "Lax";
    if (v.startsWith("s")) return "Strict";
    if (v.startsWith("n")) return "None";
    return "Lax";
  };
  
  return arr
    .filter((c) => c && c.name && typeof c.value === "string")
    .map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: c.domain || domain,
      path: c.path || "/",
      httpOnly: !!c.httpOnly,
      secure: c.secure !== false,
      sameSite: mapSameSite(c.sameSite),
      expires: c.expires ? (typeof c.expires === 'number' ? c.expires : Date.parse(c.expires)) : undefined,
    }));
}

function extractDomain(u) {
  try {
    const { hostname } = new URL(u || "https://www.facebook.com/");
    return hostname.startsWith(".") ? hostname : "." + hostname;
  } catch {
    return ".facebook.com";
  }
}

/**
 * Validate cookie format and provide helpful feedback
 */
export function validateCookies(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Cookies input must be a non-empty string' };
  }

  const trimmed = input.trim();
  
  try {
    // Test JSON parsing
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const validCookies = parsed.filter(c => c.name && c.value);
      const facebookCookies = validCookies.filter(c => 
        c.domain && c.domain.includes('facebook.com')
      );
      
      return {
        valid: facebookCookies.length > 0,
        format: 'json',
        cookieCount: validCookies.length,
        facebookCookieCount: facebookCookies.length,
        message: facebookCookies.length > 0 
          ? `Valid JSON format with ${facebookCookies.length} Facebook cookies`
          : `JSON format but no Facebook cookies found`
      };
    }
  } catch (e) {
    // Not JSON, check other formats
  }

  // Check for Netscape format
  if (trimmed.includes('.facebook.com\t') || trimmed.includes('# Netscape HTTP Cookie File')) {
    const parsed = parseNetscapeCookies(trimmed);
    return {
      valid: parsed.length > 0,
      format: 'netscape',
      cookieCount: parsed.length,
      facebookCookieCount: parsed.length,
      message: parsed.length > 0 
        ? `Valid Netscape format with ${parsed.length} Facebook cookies`
        : 'Netscape format but no valid Facebook cookies found'
    };
  }

  // Check for header format
  const headerPairs = trimmed.split(';').filter(pair => 
    pair.includes('=') && !pair.match(/^(path|domain|expires|samesite|secure|httponly)=/i)
  );
  
  return {
    valid: headerPairs.length > 0,
    format: 'header',
    cookieCount: headerPairs.length,
    facebookCookieCount: headerPairs.length, // Assume all are Facebook cookies
    message: headerPairs.length > 0 
      ? `Valid header format with ${headerPairs.length} cookie pairs`
      : 'Invalid cookie format - no valid name=value pairs found'
  };
}
