import { Actor } from 'apify';
import { chromium } from 'playwright';
import { parseCookiesInput } from './utils/cookies.js';

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
    if (hasCookies) {
        try {
            parsedCookies = parseCookiesInput(input.cookies);
            console.log('Successfully parsed cookies:', parsedCookies.length, 'cookies found');
        } catch (error) {
            console.error('Failed to parse cookies:', error.message);
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
                // Add cookies to the context
                await context.addCookies(parsedCookies);
                console.log('Cookies added to browser context successfully');
                
                // Test cookies by visiting Facebook
                const testPage = await context.newPage();
                await testPage.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                // Wait a moment for page to load
                await testPage.waitForTimeout(3000);
                
                // Check if we're logged in by looking for common logged-in elements
                const loggedInCheck = await testPage.evaluate(() => {
                    // Multiple indicators that we're logged in
                    const indicators = [
                        // Navigation elements that appear when logged in
                        document.querySelector('[data-testid="blue_bar"]'),
                        document.querySelector('[aria-label="Account"]'),
                        document.querySelector('[data-testid="nav-user-profile"]'),
                        // Check if we're not on login page
                        !document.querySelector('#email'),
                        !document.querySelector('input[name="email"]'),
                        // Check for feed or main content
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
                
                console.log('Cookie login check:', loggedInCheck);
                
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
            }
        }

        // Fallback to email/password if cookies failed or not provided
        if (!isLoggedIn && hasCredentials) {
            console.log('Attempting Facebook login with email/password...');
            
            try {
                const loginPage = await context.newPage();
                await loginPage.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                // Wait for login form
                await loginPage.waitForSelector('#email', { timeout: 10000 });
                
                // Fill login form
                await loginPage.fill('#email', input.email);
                await loginPage.fill('#pass', input.password);
                
                // Click login button
                await loginPage.click('[name="login"]');
                
                // Wait for navigation (login success or failure)
                await loginPage.waitForTimeout(5000);
                
                // Check if login was successful
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
                
                // Extract comprehensive data
                const data = await page.evaluate(() => {
                    // Multiple selectors for different types of Facebook content
                    const contentSelectors = [
                        // Post content
                        '[data-testid="post_message"]',
                        '[data-testid="post-content"]', 
                        '.userContent',
                        '.story_body_container',
                        
                        // Video/Reel specific
                        '[data-testid="video-component-description"]',
                        '[data-testid="reel-video-description"]',
                        
                        // Comments
                        '[data-testid="comment"]',
                        
                        // General content
                        '[role="article"]',
                        '.accessible_elem',
                        
                        // Page content
                        '[data-testid="page-about-content"]',
                        '[data-testid="page-header"]',
                        '.page-about-content'
                    ];
                    
                    let foundContent = [];
                    
                    contentSelectors.forEach(selector => {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => {
                            const text = el.innerText?.trim();
                            if (text && text.length > 10) {
                                foundContent.push({
                                    selector: selector,
                                    content: text.substring(0, 500)
                                });
                            }
                        });
                    });
                    
                    // Check for login requirement
                    const bodyText = document.body.innerText;
                    const requiresLogin = bodyText.includes('Log In') || 
                                        bodyText.includes('Log into Facebook') ||
                                        bodyText.includes('Create new account') ||
                                        bodyText.includes('See more on Facebook') ||
                                        bodyText.includes('You must log in');
                    
                    // Get page metadata
                    const metaTags = {};
                    document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach(meta => {
                        const property = meta.getAttribute('property') || meta.getAttribute('name');
                        const content = meta.getAttribute('content');
                        if (property && content) {
                            metaTags[property] = content;
                        }
                    });
                    
                    // Check for specific login-protected content indicators
                    const loginIndicators = [
                        'Log into Facebook to start sharing',
                        'You\'re Temporarily Blocked',
                        'Content Not Found',
                        'This content isn\'t available right now'
                    ];
                    
                    const hasLoginIndicator = loginIndicators.some(indicator => 
                        bodyText.includes(indicator)
                    );
                    
                    return {
                        url: window.location.href,
                        title: document.title,
                        timestamp: new Date().toISOString(),
                        requiresLogin: requiresLogin || hasLoginIndicator,
                        foundContent: foundContent,
                        contentCount: foundContent.length,
                        allText: bodyText.substring(0, 3000),
                        htmlLength: document.documentElement.innerHTML.length,
                        metaTags: metaTags,
                        hasFacebookElements: document.querySelector('[data-testid]') !== null,
                        pageType: detectPageType(window.location.href, bodyText)
                    };
                    
                    function detectPageType(url, text) {
                        if (url.includes('/posts/')) return 'post';
                        if (url.includes('/videos/')) return 'video';
                        if (url.includes('/photos/')) return 'photo';
                        if (url.includes('/events/')) return 'event';
                        if (text.includes('Business Page')) return 'business_page';
                        if (text.includes('Public Figure')) return 'public_figure';
                        return 'page';
                    }
                });
                
                // Enhanced result with authentication info
                const result = {
                    ...data,
                    authentication: {
                        isLoggedIn: isLoggedIn,
                        method: authMethod,
                        cookiesUsed: authMethod === 'cookies'
                    }
                };
                
                // Determine success and provide appropriate feedback
                if (data.requiresLogin && !isLoggedIn) {
                    console.log('Content requires login and no valid authentication');
                    await Actor.pushData({
                        ...result,
                        warning: 'Content requires login. Provide valid Facebook cookies or email/password for full access.',
                        partialData: true
                    });
                } else if (data.requiresLogin && isLoggedIn) {
                    console.log('Content was login-protected but we have valid authentication');
                    await Actor.pushData({
                        ...result,
                        warning: 'Content required login - accessed with valid authentication'
                    });
                } else if (data.contentCount > 0) {
                    console.log(`Success! Found ${data.contentCount} content elements`);
                    await Actor.pushData(result);
                } else {
                    console.log('No content found, but page loaded successfully');
                    await Actor.pushData({
                        ...result,
                        warning: 'Page loaded but no recognizable content found'
                    });
                }
                
            } catch (error) {
                console.error(`Error processing ${url}:`, error.message);
                await Actor.pushData({
                    url: url,
                    error: error.message,
                    failed: true,
                    timestamp: new Date().toISOString(),
                    authentication: {
                        isLoggedIn: isLoggedIn,
                        method: authMethod,
                        cookiesUsed: authMethod === 'cookies'
                    }
                });
            } finally {
                await page.close();
            }
            
            // Delay between requests
            if (i < urls.length - 1) {
                const delay = isLoggedIn ? 2000 : 5000; // Shorter delay if logged in
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
