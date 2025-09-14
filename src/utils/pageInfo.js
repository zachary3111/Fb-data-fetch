/** Extract page info by navigating to About tab. Best-effort; optional. */
export async function extractPageInfo(page) {
  const info = { pageUrl: null, category: null, phone: null, email: null, address: null, creationDate: null };

  const pageUrl = await page.evaluate(() => {
    const scope = document.querySelector('[role="article"]') || document;
    const anchors = Array.from(scope.querySelectorAll('a[href]'));
    const urls = anchors
      .map((a) => a.href || a.getAttribute('href') || '')
      .map((h) => { try { return new URL(h, location.href).href; } catch { return ''; } })
      .filter(Boolean);
    const candidate = urls.find((u) => u.includes('facebook.com/') && !/(watch|photos?|videos?|groups|permalink|posts)\//.test(u));
    return candidate || null;
  });
  info.pageUrl = pageUrl;
  if (!pageUrl) return info;

  const aboutCandidates = [
    pageUrl.replace(/\/$/, '') + '/about',
    pageUrl.replace(/\/$/, '') + '/about_contact_and_basic_info',
  ];

  for (const url of aboutCandidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(400);
      const extracted = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        const maybe = (re) => { const m = txt.match(re); return m ? m[1].trim() : null; };
        return {
          category: maybe(/Category\s*\n([^\n]+)/i),
          phone: maybe(/Phone\s*\n([^\n]+)/i),
          email: maybe(/Email\s*\n([^\n]+)/i),
          address: maybe(/Address\s*\n([^\n]+)/i),
          creationDate: maybe(/Created on\s*\n([^\n]+)/i),
        };
      });
      return { ...info, ...extracted };
    } catch {}
  }
  return info;
}