import { Actor } from 'apify';
import { chromium } from 'playwright';

await Actor.init();

try {
    console.log('Actor started successfully!');
    
    const input = await Actor.getInput();
    console.log('Raw input (excluding sensitive data):', {
        urls: input.urls,
        maxItems: input.maxItems,
        hasEmail: !!input.email,
        hasPassword: !!input.password,
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

    // Check if login credentials are provided
    const hasCredentials = input.email && input.password;
    console.log('Login credentials provided:', hasCredentials);

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

        // Login if credentials provided
        if (hasCredentials) {
            console.log('Attempting Facebook login...');
            
            try {
                const loginPage = await context.newPage();
                await loginPage.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });
                
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
                    console.log('Login successful!');
                    isLoggedIn = true;
                } else {
                    console.log('Login failed - invalid credentials or security check');
                }
                
                await loginPage.close();
                
            } catch (error) {
                console.error('Login error:', error.message);
            }
        }

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
                        '.accessible_elem'
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
                                        bodyText.includes('Create new account') ||
                                        bodyText.includes('See more on Facebook');
                    
                    // Get page metadata
                    const metaTags = {};
                    document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach(meta => {
                        const property = meta.getAttribute('property') || meta.getAttribute('name');
                        const content = meta.getAttribute('content');
                        if (property && content) {
                            metaTags[property] = content;
                        }
                    });
                    
                    return {
                        url: window.location.href,
                        title: document.title,
                        timestamp: new Date().toISOString(),
                        requiresLogin: requiresLogin,
                        foundContent: foundContent,
                        contentCount: foundContent.length,
                        allText: bodyText.substring(0, 3000),
                        htmlLength: document.documentElement.innerHTML.length,
                        metaTags: metaTags,
                        hasFacebookElements: document.querySelector('[data-testid]') !== null
                    };
                });
                
                // Determine success
                if (data.requiresLogin && !isLoggedIn) {
                    console.log('Content requires login and no valid session');
                    await Actor.pushData({
                        ...data,
                        warning: 'Content requires login. Provide email/password in input for full access.',
                        partialData: true
                    });
                } else if (data.contentCount > 0) {
                    console.log(`Success! Found ${data.contentCount} content elements`);
                    await Actor.pushData(data);
                } else {
                    console.log('No content found, but page loaded successfully');
                    await Actor.pushData({
                        ...data,
                        warning: 'Page loaded but no recognizable content found'
                    });
                }
                
            } catch (error) {
                console.error(`Error processing ${url}:`, error.message);
                await Actor.pushData({
                    url: url,
                    error: error.message,
                    failed: true,
                    timestamp: new Date().toISOString()
                });
            } finally {
                await page.close();
            }
            
            // Delay between requests
            if (i < urls.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
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
