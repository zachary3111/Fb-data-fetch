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
                await page.waitForTimeout(5000);

                // Take screenshot for debugging
                const screenshotBuffer = await page.screenshot({ 
                    fullPage: false,
                    type: 'png'
                });
                
                const screenshotKey = `screenshot_${Date.now()}_${i}`;
                await Actor.setValue(screenshotKey, screenshotBuffer, { contentType: 'image/png' });

                // Extract comprehensive post data
                const postData = await page.evaluate(() => {
                    // Enhanced post text extraction
                    function extractPostText() {
                        const selectors = [
                            '[data-testid="post_message"]',
                            '[data-ad-preview="message"]',
                            '.userContent',
                            'div[dir="auto"]',
                            '.story_body_container div',
                            '[role="article"] div[dir="auto"]',
                            '.text_exposed_root',
                            '.text_exposed_show'
                        ];

                        for (const selector of selectors) {
                            const elements = document.querySelectorAll(selector);
                            for (const el of elements) {
                                const text = el.innerText?.trim();
                                if (text && text.length > 50 && !isUIText(text)) {
                                    return text;
                                }
                            }
                        }

                        // Fallback: smart text extraction
                        const bodyText = document.body.innerText;
                        const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
                        
                        // Look for substantial content blocks
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (line.length > 100 && !isUIText(line)) {
                                // Check if next few lines are related
                                let fullText = line;
                                for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                                    const nextLine = lines[j];
                                    if (nextLine.length > 20 && !isUIText(nextLine) && 
                                        !nextLine.match(/^\d+\s+(likes?|comments?|shares?)$/i)) {
                                        fullText += '\n' + nextLine;
                                    } else if (nextLine.length < 20) {
                                        break;
                                    }
                                }
                                if (fullText.length > 200) {
                                    return fullText;
                                }
                            }
                        }

                        return null;
                    }

                    function isUIText(text) {
                        const uiPatterns = [
                            /^(Like|Comment|Share|See more|Facebook|Meta|Privacy|Terms|Home)$/i,
                            /^\d+(\s+(comments?|likes?|shares?|reactions?))?$/i,
                            /^(What's on your mind|Create a post|Live video)$/i,
                            /^\d+\s+(Unread|unread)/i,
                            /^(Friends|Groups|Marketplace|Messages|Messenger)$/i,
                            /^(All reactions|Write a comment)$/i
                        ];
                        
                        return uiPatterns.some(pattern => pattern.test(text.trim())) ||
                               text.length < 10 ||
                               (text.split(' ').length < 4 && !text.includes('\n'));
                    }

                    // Extract page URL from post
                    function extractPageUrl() {
                        const links = document.querySelectorAll('a[href*="facebook.com/"]');
                        for (const link of links) {
                            const href = link.href;
                            if (href.includes('facebook.com/') && 
                                !href.includes('/posts/') && 
                                !href.includes('/photos/') &&
                                !href.includes('/videos/') &&
                                !href.includes('permalink') &&
                                link.innerText && 
                                link.innerText.trim().length > 2) {
                                return href;
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

                // Extract time information
                const timeInfo = await extractPostDateISO(page, { enableOcr: false });
                
                // Extract page information
                let pageInfo = { category: null, phone: null, email: null, address: null, creationDate: null };
                if (postData.pageUrl) {
                    try {
                        pageInfo = await extractPageInfo(page);
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
                    status: postData.postText ? 'success' : 'limited_content'
                };

                console.log('Extracted data summary:', {
                    hasPostText: !!result.postText,
                    hasPageUrl: !!result.pageUrl,
                    hasTimeInfo: !!result.posted_at_iso,
                    hasPageInfo: !!(result.category || result.phone || result.email)
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
