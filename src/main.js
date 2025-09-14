import { Actor } from 'apify';
import { chromium } from 'playwright';

await Actor.init();

try {
    console.log('Actor started successfully!');
    
    // Get the input
    const input = await Actor.getInput();
    console.log('Raw input:', input);

    // Process the URLs input
    let urls;
    if (typeof input.urls === 'string') {
        urls = input.urls
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0);
    } else if (Array.isArray(input.urls)) {
        urls = input.urls;
    } else {
        throw new Error('Input "urls" must be a string (one URL per line) or an array of URLs');
    }

    if (!urls || urls.length === 0) {
        throw new Error('Input "urls" must be a non-empty array');
    }

    console.log('Processed URLs:', urls);

    // Launch browser with more comprehensive options
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

    console.log('Browser launched successfully!');

    try {
        // Create a single page context
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Process each URL
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`Processing URL ${i + 1}/${urls.length}: ${url}`);
            
            const page = await context.newPage();
            
            try {
                // Set a longer timeout and better error handling
                console.log(`Navigating to: ${url}`);
                const response = await page.goto(url, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 45000 
                });
                
                if (!response || !response.ok()) {
                    throw new Error(`Failed to load page: ${response?.status()} ${response?.statusText()}`);
                }
                
                console.log('Page loaded, waiting for content...');
                
                // Wait for content to load with fallback
                try {
                    await page.waitForSelector('body', { timeout: 10000 });
                } catch (e) {
                    console.log('Body selector timeout, continuing anyway...');
                }
                
                // Add a small delay to let dynamic content load
                await page.waitForTimeout(3000);
                
                // Extract data
                console.log('Extracting data...');
                const data = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        title: document.title,
                        timestamp: new Date().toISOString(),
                        content: document.body?.innerText?.substring(0, 2000) || 'No content found',
                        htmlLength: document.documentElement.innerHTML.length,
                        // Basic Facebook post detection
                        hasFacebookContent: document.querySelector('[data-testid]') !== null,
                    };
                });

                console.log(`Successfully scraped: ${data.title}`);
                console.log(`Content preview: ${data.content.substring(0, 100)}...`);
                
                // Save the data
                await Actor.pushData(data);
                
            } catch (error) {
                console.error(`Error processing ${url}:`, error.message);
                
                // Save error info
                await Actor.pushData({
                    url: url,
                    error: error.message,
                    failed: true,
                    timestamp: new Date().toISOString()
                });
            } finally {
                await page.close();
            }
            
            // Small delay between requests
            if (i < urls.length - 1) {
                console.log('Waiting before next request...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        await context.close();
        
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
    
    console.log('Scraping completed successfully!');

} catch (error) {
    console.error('Actor failed:', error.message);
    console.error('Full error:', error);
    throw error;
}

await Actor.exit();
