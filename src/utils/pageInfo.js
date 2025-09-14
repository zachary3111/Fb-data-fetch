/** 
 * Extract page info by navigating to About tab. Best-effort; optional. 
 * Enhanced with better navigation and extraction methods.
 */
export async function extractPageInfo(page, pageUrl = null) {
  const info = { pageUrl: null, category: null, phone: null, email: null, address: null, creationDate: null };

  // If pageUrl wasn't provided, try to extract it from current page
  if (!pageUrl) {
    pageUrl = await page.evaluate(() => {
      const scope = document.querySelector('[role="article"]') || document;
      const anchors = Array.from(scope.querySelectorAll('a[href]'));
      const urls = anchors
        .map((a) => a.href || a.getAttribute('href') || '')
        .map((h) => { try { return new URL(h, location.href).href; } catch { return ''; } })
        .filter(Boolean);
      const candidate = urls.find((u) => u.includes('facebook.com/') && !/(watch|photos?|videos?|groups|permalink|posts)\//.test(u));
      return candidate || null;
    });
  }
  
  info.pageUrl = pageUrl;
  if (!pageUrl) {
    console.log('No page URL found for info extraction');
    return info;
  }

  console.log('Attempting to extract page info from:', pageUrl);

  // Clean the URL and prepare about page candidates
  const cleanUrl = pageUrl.replace(/\/$/, '');
  const aboutCandidates = [
    cleanUrl + '/about',
    cleanUrl + '/about_contact_and_basic_info',
    cleanUrl + '/about/',
    cleanUrl + '/about_contact_and_basic_info/',
    cleanUrl + '?sk=about',
    cleanUrl + '?sk=about_contact_and_basic_info'
  ];

  for (const url of aboutCandidates) {
    try {
      console.log('Trying about URL:', url);
      
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      if (!response || !response.ok()) {
        console.log(`Failed to load ${url}: ${response?.status()}`);
        continue;
      }
      
      // Wait for content to load
      await page.waitForTimeout(2000);
      
      // Enhanced extraction with multiple strategies
      const extracted = await page.evaluate(() => {
        console.log('Extracting page info from DOM...');
        
        const info = {
          category: null,
          phone: null,
          email: null,
          address: null,
          creationDate: null
        };
        
        // Strategy 1: Look for structured data sections
        const sections = document.querySelectorAll('div, section, span, td, th');
        
        for (const section of sections) {
          const text = section.textContent || '';
          const innerHTML = section.innerHTML || '';
          
          // Category extraction
          if (!info.category) {
            const categoryPatterns = [
              /(?:category|type|business\s+type)\s*:?\s*([^\n]+)/i,
              /(?:page\s+)?category\s*:?\s*([^\n\r]+)/i,
              /business\s+classification\s*:?\s*([^\n]+)/i
            ];
            
            for (const pattern of categoryPatterns) {
              const match = text.match(pattern);
              if (match && match[1] && match[1].trim().length > 0) {
                info.category = match[1].trim();
                console.log('Found category via pattern:', info.category);
                break;
              }
            }
          }
          
          // Phone extraction - enhanced patterns
          if (!info.phone) {
            const phonePatterns = [
              /(?:phone|tel|telephone|call)\s*:?\s*([\+]?[\d\s\-\(\)\.]{8,20})/i,
              /(?:contact|call\s+us)\s*:?\s*([\+]?[\d\s\-\(\)\.]{8,20})/i,
              /([\+]?[\d]{1,4}[\s\-]?[\d\s\-\(\)\.]{8,20})/g
            ];
            
            for (const pattern of phonePatterns) {
              const matches = text.matchAll(pattern);
              for (const match of matches) {
                const candidate = match[1] ? match[1].trim() : match[0].trim();
                // Validate phone number format
                if (candidate.replace(/[\s\-\(\)\.]/g, '').length >= 8 && 
                    /[\d\+\-\(\)\s\.]{8,}/.test(candidate) &&
                    !candidate.includes('@') &&
                    !candidate.includes('facebook.com')) {
                  info.phone = candidate;
                  console.log('Found phone via pattern:', info.phone);
                  break;
                }
              }
              if (info.phone) break;
            }
          }
          
          // Email extraction
          if (!info.email) {
            const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
            const emailMatches = text.match(emailPattern);
            if (emailMatches && emailMatches.length > 0) {
              // Filter out Facebook emails and get the first real business email
              const businessEmail = emailMatches.find(email => 
                !email.includes('facebook.com') && 
                !email.includes('fb.com') &&
                !email.includes('messenger.com')
              );
              if (businessEmail) {
                info.email = businessEmail.trim();
                console.log('Found email via pattern:', info.email);
              }
            }
          }
          
          // Address extraction - enhanced
          if (!info.address) {
            const addressPatterns = [
              /(?:address|location|located\s+at)\s*:?\s*([^\n\r]{10,150})/i,
              /(?:visit\s+us|find\s+us)\s*:?\s*([^\n\r]{10,150})/i,
              /(?:our\s+location)\s*:?\s*([^\n\r]{10,150})/i
            ];
            
            for (const pattern of addressPatterns) {
              const match = text.match(pattern);
              if (match && match[1] && match[1].trim().length >= 10) {
                const candidate = match[1].trim();
                // Basic validation - should contain some address-like elements
                if (candidate.match(/\d/) && (
                    candidate.toLowerCase().includes('street') ||
                    candidate.toLowerCase().includes('road') ||
                    candidate.toLowerCase().includes('avenue') ||
                    candidate.toLowerCase().includes('drive') ||
                    candidate.toLowerCase().includes('lane') ||
                    candidate.toLowerCase().includes('city') ||
                    candidate.match(/\d{5}/) // ZIP code
                  )) {
                  info.address = candidate;
                  console.log('Found address via pattern:', info.address);
                  break;
                }
              }
            }
          }
          
          // Creation date extraction
          if (!info.creationDate) {
            const datePatterns = [
              /(?:created|established|founded|started)\s*(?:on|in)?\s*:?\s*(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i,
              /(?:page\s+created|business\s+started)\s*:?\s*([^\n\r]{5,50})/i,
              /(?:since|est\.?\s*)\s*(\d{4}|january|february|march|april|may|june|july|august|september|october|november|december)/i
            ];
            
            for (const pattern of datePatterns) {
              const match = text.match(pattern);
              if (match && match[1] && match[1].trim().length > 0) {
                info.creationDate = match[1].trim();
                console.log('Found creation date via pattern:', info.creationDate);
                break;
              }
            }
          }
        }
        
        // Strategy 2: Look for specific Facebook about page elements
        const fbSpecificElements = document.querySelectorAll('[data-testid], [aria-label], [role="cell"], [role="rowheader"]');
        
        for (const el of fbSpecificElements) {
          const text = el.textContent || '';
          const label = el.getAttribute('aria-label') || '';
          const testId = el.getAttribute('data-testid') || '';
          
          // Look for category in Facebook's structured format
          if (!info.category && (label.toLowerCase().includes('category') || testId.includes('category'))) {
            const nextSibling = el.nextElementSibling;
            if (nextSibling && nextSibling.textContent) {
              info.category = nextSibling.textContent.trim();
              console.log('Found category via FB structure:', info.category);
            }
          }
          
          // Look for contact info in structured format
          if (text.includes('Contact info') || label.includes('Contact')) {
            const parent = el.closest('div') || el.parentElement;
            if (parent) {
              const contactText = parent.textContent || '';
              
              if (!info.phone) {
                const phoneMatch = contactText.match(/([\+]?[\d\s\-\(\)\.]{8,20})/);
                if (phoneMatch) {
                  info.phone = phoneMatch[1].trim();
                  console.log('Found phone via FB contact section:', info.phone);
                }
              }
              
              if (!info.email) {
                const emailMatch = contactText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                if (emailMatch && !emailMatch[1].includes('facebook.com')) {
                  info.email = emailMatch[1].trim();
                  console.log('Found email via FB contact section:', info.email);
                }
              }
            }
          }
        }
        
        console.log('Final extracted info:', info);
        return info;
      });
      
      // Merge extracted data
      Object.keys(extracted).forEach(key => {
        if (extracted[key] && !info[key]) {
          info[key] = extracted[key];
        }
      });
      
      console.log('Page info extraction result:', info);
      
      // If we found substantial info, return it
      if (extracted.category || extracted.phone || extracted.email || extracted.address) {
        return info;
      }
      
    } catch (error) {
      console.log(`Error loading ${url}:`, error.message);
      continue;
    }
  }
  
  console.log('Final page info:', info);
  return info;
}
