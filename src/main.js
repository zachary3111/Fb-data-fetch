import { Actor } from 'apify';
import { chromium } from 'playwright';
import { parseCookiesInput } from './utils/cookies.js';
import { extractPostDateISO } from './utils/postTime.js';
import { extractPageInfo } from './utils/pageInfo.js';

await Actor.init();

try {
    console.log('Actor started successfully!');
    
    const input = await Actor.getInput();
    console.log('Raw input (excluding sensitive data):', {
        urls: input.urls,
        maxItems: input.maxItems,
        hasEmail: !!input.email,
        hasPassword: !!input.password,
        hasCookies: !!input.cookies,
        useLoginBypass: input.useLoginBypass
    });

    // Process URLs
    let urls;
    if (typeof input.urls === 'string') {
        urls = input.urls.split('\n').map(url => url.trim()).filter(url => url.length > 0);
    } else if (Array.isArray(input.urls)) {
        urls = input.urls;
    } else {
        throw new Error('Input "urls" must be a string (one URL per line) or an array of URLs');
    }

    if (!urls || urls.length === 0) {
        throw new Error('Input "urls" must be a non-empty array');
    }

    console.log('Processed URLs:', urls);

    // Check authentication methods
    const hasCredentials = input.email && input.password;
    const hasCookies = input.cookies;
    console.log('Login credentials provided:', hasCredentials);
    console.log('Facebook cookies provided:', hasCookies);

    // Parse cookies if provided
    let parsedCookies = [];
    let cookieApplyResult = { set: 0, skipped: 0, errors: [] };
    
    if (hasCookies) {
        try {
            parsedCookies = parseCookiesInput(input.cookies);
            console.log('Successfully parsed cookies:', parsedCookies.length, 'cookies found');
            cookieApplyResult.set = parsedCookies.length;
        } catch (error) {
            console.error('Failed to parse cookies:', error.message);
            cookieApplyResult.errors.push(error.message);
        }
    }

    // Launch browser
    console.log('Launching browser...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--window-size=1920,1080'
        ]
    });

    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        let isLoggedIn = false;
        let authMethod = 'none';

        // Priority: Cookies first, then email/password
        if (parsedCookies.length > 0) {
            console.log('Attempting to set Facebook cookies...');
            
            try {
                await context.addCookies(parsedCookies);
                console.log('Cookies added to browser context successfully');
                
                const testPage = await context.newPage();
                await testPage.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
                await testPage.waitForTimeout(3000);
                
                const loggedInCheck = await testPage.evaluate(() => {
                    const indicators = [
                        document.querySelector('[data-testid="blue_bar"]'),
                        document.querySelector('[aria-label="Account"]'),
                        document.querySelector('[data-testid="nav-user-profile"]'),
                        !document.querySelector('#email'),
                        !document.querySelector('input[name="email"]'),
                        document.querySelector('[role="feed"]'),
                        document.querySelector('[data-pagelet="FeedUnit"]')
                    ];
                    
                    const positiveIndicators = indicators.filter(Boolean).length;
                    const currentUrl = window.location.href;
                    const notOnLoginPage = !currentUrl.includes('/login') && !currentUrl.includes('/recover');
                    
                    return {
                        loggedIn: positiveIndicators >= 2 && notOnLoginPage,
                        url: currentUrl,
                        positiveIndicators: positiveIndicators,
                        hasUserElements: !!document.querySelector('[data-testid="blue_bar"]')
                    };
                });
                
                if (loggedInCheck.loggedIn) {
                    console.log('Cookie authentication successful!');
                    isLoggedIn = true;
                    authMethod = 'cookies';
                } else {
                    console.log('Cookies appear invalid or expired');
                }
                
                await testPage.close();
                
            } catch (error) {
                console.error('Cookie authentication error:', error.message);
                cookieApplyResult.errors.push(error.message);
            }
        }

        // Fallback to email/password if cookies failed or not provided
        if (!isLoggedIn && hasCredentials) {
            console.log('Attempting Facebook login with email/password...');
            
            try {
                const loginPage = await context.newPage();
                await loginPage.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                await loginPage.waitForSelector('#email', { timeout: 10000 });
                
                await loginPage.fill('#email', input.email);
                await loginPage.fill('#pass', input.password);
                await loginPage.click('[name="login"]');
                await loginPage.waitForTimeout(5000);
                
                const currentUrl = loginPage.url();
                if (currentUrl.includes('facebook.com') && !currentUrl.includes('login')) {
                    console.log('Email/password login successful!');
                    isLoggedIn = true;
                    authMethod = 'credentials';
                } else {
                    console.log('Login failed - invalid credentials or security check');
                }
                
                await loginPage.close();
                
            } catch (error) {
                console.error('Email/password login error:', error.message);
            }
        }

        console.log('Final authentication status:', { isLoggedIn, authMethod });

        // Process each URL
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`Processing URL ${i + 1}/${urls.length}: ${url}`);
            
            const page = await context.newPage();
            
            try {
                console.log(`Navigating to: ${url}`);
                
                const response = await page.goto(url, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });
                
                if (!response || !response.ok()) {
                    throw new Error(`Failed to load page: ${response?.status()}`);
                }
                
                // Wait for content to load
                await page.waitForTimeout(3000);

                // Enhanced content expansion - try multiple methods
                console.log('Attempting to expand post content...');
                
                // Method 1: Look for "See more" buttons with various selectors
                const seeMoreSelectors = [
                    'div[role="button"]:has-text("See more")',
                    'div[role="button"]:has-text("see more")',
                    'div[role="button"]:has-text("Show more")',
                    'span:has-text("See more")',
                    'span:has-text("see more")',
                    '[aria-label="See more"]',
                    'div[dir="auto"] span:has-text("See more")',
                    '.see_more_link',
                    '.see_more'
                ];
                
                let expanded = false;
                for (const selector of seeMoreSelectors) {
                    try {
                        const element = page.locator(selector).first();
                        if (await element.isVisible({ timeout: 2000 })) {
                            await element.click();
                            await page.waitForTimeout(2000);
                            console.log(`Successfully clicked "See more" using selector: ${selector}`);
                            expanded = true;
                            break;
                        }
                    } catch (e) {
                        // Continue to next selector
                    }
                }
                
                // Method 2: Look for ellipsis patterns and try clicking parent elements
                if (!expanded) {
                    try {
                        const ellipsisElements = await page.locator('text=/…|\.{3}|See more/').all();
                        for (const el of ellipsisElements) {
                            try {
                                const parent = el.locator('..');
                                if (await parent.isVisible()) {
                                    await parent.click();
                                    await page.waitForTimeout(1000);
                                    console.log('Clicked ellipsis parent element');
                                    expanded = true;
                                    break;
                                }
                            } catch (e) {
                                // Continue
                            }
                        }
                    } catch (e) {
                        // Continue
                    }
                }

                // Take screenshot for debugging
                const screenshotBuffer = await page.screenshot({ 
                    fullPage: false,
                    type: 'png'
                });
                
                const screenshotKey = `screenshot_${Date.now()}_${i}`;
                await Actor.setValue(screenshotKey, screenshotBuffer, { contentType: 'image/png' });

                // Enhanced post data extraction
                const postData = await page.evaluate(() => {
                    // Enhanced post text extraction with multiple strategies
                    function extractPostText() {
                        console.log('Extracting post text...');
                        
                        // Strategy 1: Look for expanded content first
                        const expandedSelectors = [
                            '[data-testid="post_message"]',
                            '[data-ad-preview="message"]',
                            '.userContent .text_exposed_show',
                            '.text_exposed_show',
                            'div[data-testid="post_message"] div[dir="auto"]',
                            '.story_body_container .userContent',
                            '[role="article"] div[dir="auto"]:not(.see_more_link_inner)'
                        ];

                        for (const selector of expandedSelectors) {
                            const elements = document.querySelectorAll(selector);
                            for (const el of elements) {
                                const text = el.innerText?.trim();
                                if (text && text.length > 20 && !isUIText(text) && !text.includes('…')) {
                                    console.log(`Found text using selector ${selector}:`, text.substring(0, 100));
                                    return text;
                                }
                            }
                        }

                        // Strategy 2: Look within article role for div elements with substantial text
                        const article = document.querySelector('[role="article"]');
                        if (article) {
                            const divs = article.querySelectorAll('div[dir="auto"]');
                            for (const div of divs) {
                                const text = div.innerText?.trim();
                                if (text && text.length > 50 && !isUIText(text)) {
                                    // Check if this is actual post content vs UI text
                                    const parentStyle = window.getComputedStyle(div.parentElement || div);
                                    const hasReasonableFont = !parentStyle.fontSize || 
                                        parseInt(parentStyle.fontSize) >= 12;
                                    
                                    if (hasReasonableFont && !text.match(/^(Like|Comment|Share|See more)$/i)) {
                                        console.log('Found text in article div:', text.substring(0, 100));
                                        return text;
                                    }
                                }
                            }
                        }

                        // Strategy 3: Look for the main content container
                        const contentSelectors = [
                            '.userContent',
                            '.story_body_container',
                            '[data-testid="story-subtitle"]',
                            'div[data-ad-preview="message"]'
                        ];

                        for (const selector of contentSelectors) {
                            const element = document.querySelector(selector);
                            if (element) {
                                const text = element.innerText?.trim();
                                if (text && text.length > 20 && !isUIText(text)) {
                                    console.log(`Found text using ${selector}:`, text.substring(0, 100));
                                    return text;
                                }
                            }
                        }

                        // Strategy 4: Intelligent text scanning from body
                        const bodyText = document.body.innerText;
                        const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
                        
                        // Look for substantial content blocks that aren't UI
                        let potentialContent = [];
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (line.length > 30 && !isUIText(line) && 
                                !line.match(/^\d+\s+(likes?|comments?|shares?|reactions?)$/i) &&
                                !line.match(/^(Home|Watch|Marketplace|Groups|Gaming)$/i)) {
                                
                                // Check if next few lines are related content
                                let fullText = line;
                                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                                    const nextLine = lines[j];
                                    if (nextLine.length > 15 && !isUIText(nextLine) && 
                                        !nextLine.match(/^\d+\s+(likes?|comments?|shares?)$/i) &&
                                        !nextLine.match(/^(Like|Comment|Share)$/i)) {
                                        fullText += '\n' + nextLine;
                                    } else {
                                        break;
                                    }
                                }
                                
                                if (fullText.length > 100) {
                                    potentialContent.push(fullText);
                                }
                            }
                        }
                        
                        // Return the longest potential content
                        if (potentialContent.length > 0) {
                            const longest = potentialContent.reduce((a, b) => 
                                a.length > b.length ? a : b
                            );
                            console.log('Found content via intelligent scanning:', longest.substring(0, 100));
                            return longest;
                        }

                        return null;
                    }

                    function isUIText(text) {
                        const uiPatterns = [
                            /^(Like|Comment|Share|See more|See less|Facebook|Meta|Privacy|Terms|Home|Watch|Marketplace|Groups|Gaming)$/i,
                            /^\d+(\s+(comments?|likes?|shares?|reactions?|views?))?$/i,
                            /^(What's on your mind|Create a post|Live video|Photo\/Video|Feeling\/Activity)$/i,
                            /^\d+\s+(Unread|unread|notification)/i,
                            /^(Friends|Messages|Messenger|Notifications)$/i,
                            /^(All reactions|Write a comment|Press Enter to post)$/i,
                            /^(Story|Stories|Create story)$/i,
                            /^(Sponsored|Ad|Advertisement)$/i,
                            /^(More|Options|Menu)$/i
                        ];
                        
                        return uiPatterns.some(pattern => pattern.test(text.trim())) ||
                               text.length < 5 ||
                               text.match(/^[^\w]*$/) || // Only symbols
                               (text.split(/\s+/).length < 3 && text.length < 50);
                    }

                    // Extract page URL from post with better detection
                    function extractPageUrl() {
                        // Look for author links in the post header
                        const authorSelectors = [
                            '[role="article"] h3 a[href*="facebook.com/"]',
                            '[role="article"] h2 a[href*="facebook.com/"]', 
                            '[role="article"] strong a[href*="facebook.com/"]',
                            'a[href*="facebook.com/"]:has(strong)',
                            'a[role="link"][href*="facebook.com/"]'
                        ];

                        for (const selector of authorSelectors) {
                            const links = document.querySelectorAll(selector);
                            for (const link of links) {
                                const href = link.href;
                                if (href.includes('facebook.com/') && 
                                    !href.includes('/posts/') && 
                                    !href.includes('/photos/') &&
                                    !href.includes('/videos/') &&
                                    !href.includes('/permalink') &&
                                    !href.includes('?') &&
                                    link.textContent && 
                                    link.textContent.trim().length > 2) {
                                    
                                    // Clean the URL
                                    let cleanUrl = href.split('?')[0].split('#')[0];
                                    if (!cleanUrl.endsWith('/')) {
                                        cleanUrl += '/';
                                    }
                                    return cleanUrl;
                                }
                            }
                        }
                        
                        return null;
                    }

                    const postText = extractPostText();
                    const pageUrl = extractPageUrl();

                    return {
                        postText: postText,
                        text: postText, // Duplicate for compatibility
                        pageUrl: pageUrl,
                        title: document.title,
                        currentUrl: window.location.href
                    };
                });

                // Enhanced time information extraction
                console.log('Extracting time information...');
                const timeInfo = await extractPostDateISO(page, { enableOcr: false });
                console.log('Time info result:', timeInfo);
                
                // Extract page information if we have a page URL
                let pageInfo = { category: null, phone: null, email: null, address: null, creationDate: null };
                if (postData.pageUrl) {
                    console.log('Extracting page info from:', postData.pageUrl);
                    try {
                        pageInfo = await extractPageInfo(page, postData.pageUrl);
                        console.log('Page info result:', pageInfo);
                    } catch (error) {
                        console.log('Could not extract page info:', error.message);
                    }
                }

                // Build comprehensive result
                const result = {
                    postUrl: url,
                    cookie_apply: cookieApplyResult,
                    screenshotUrl: `https://api.apify.com/v2/key-value-stores/${process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID}/records/${screenshotKey}`,
                    screenshotKey: screenshotKey,
                    
                    // Time information
                    posted_at_raw: timeInfo?.raw || null,
                    posted_at_iso: timeInfo?.iso || null,
                    time_source: timeInfo?.source || null,
                    postDate: timeInfo?.raw || null,
                    
                    // Content
                    postText: postData.postText || null,
                    text: postData.text || null,
                    
                    // Page information
                    pageUrl: postData.pageUrl || null,
                    category: pageInfo.category || null,
                    phone: pageInfo.phone || null,
                    email: pageInfo.email || null,
                    address: pageInfo.address || null,
                    creationDate: pageInfo.creationDate || null,
                    
                    // Status
                    status: (postData.postText && timeInfo?.iso) ? 'success' : 
                           (postData.postText || timeInfo?.iso) ? 'partial_success' : 'limited_content'
                };

                console.log('Extracted data summary:', {
                    hasPostText: !!result.postText,
                    postTextLength: result.postText ? result.postText.length : 0,
                    hasPageUrl: !!result.pageUrl,
                    hasTimeInfo: !!result.posted_at_iso,
                    hasPageInfo: !!(result.category || result.phone || result.email),
                    timeSource: result.time_source,
                    status: result.status
                });

                await Actor.pushData(result);
                
            } catch (error) {
                console.error(`Error processing ${url}:`, error.message);
                
                await Actor.pushData({
                    postUrl: url,
                    cookie_apply: cookieApplyResult,
                    error: error.message,
                    status: 'error',
                    screenshotUrl: null,
                    screenshotKey: null,
                    posted_at_raw: null,
                    posted_at_iso: null,
                    time_source: null,
                    postDate: null,
                    postText: null,
                    text: null,
                    pageUrl: null,
                    category: null,
                    phone: null,
                    email: null,
                    address: null,
                    creationDate: null
                });
            } finally {
                await page.close();
            }
            
            // Delay between requests
            if (i < urls.length - 1) {
                const delay = isLoggedIn ? 2000 : 5000;
                console.log(`Waiting ${delay}ms before next request...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        await context.close();
        
    } finally {
        await browser.close();
    }
    
    console.log('Scraping completed!');

} catch (error) {
    console.error('Actor failed:', error.message);
    throw error;
}

await Actor.exit();
