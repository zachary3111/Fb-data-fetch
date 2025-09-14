import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

try {
    // Get the input
    const input = await Actor.getInput();
    console.log('Raw input:', input);

    // Process the URLs input - convert from string to array if needed
    let urls;
    if (typeof input.urls === 'string') {
        // Split by newlines and filter out empty lines
        urls = input.urls
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0);
    } else if (Array.isArray(input.urls)) {
        urls = input.urls;
    } else {
        throw new Error('Input "urls" must be a string (one URL per line) or an array of URLs');
    }

    // Validate that we have URLs
    if (!urls || urls.length === 0) {
        throw new Error('Input "urls" must be a non-empty array');
    }

    console.log('Processed URLs:', urls);

    // Create the crawler with Playwright
    const crawler = new PlaywrightCrawler({
        // Explicitly specify we want to use Playwright
        browserPoolOptions: {
            useFingerprints: false,
            preLaunchHooks: [],
            postLaunchHooks: [],
        },
        launchContext: {
            launcher: 'playwright',
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                ]
            }
        },
        requestHandler: async ({ page, request }) => {
            console.log(`Processing: ${request.url}`);
            
            try {
                // Navigate to the URL
                await page.goto(request.url, { 
                    waitUntil: 'networkidle', 
                    timeout: 30000 
                });
                
                // Wait for body element
                await page.waitForSelector('body', { timeout: 10000 });
                
                // Get basic page information
                const data = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        title: document.title,
                        timestamp: new Date().toISOString(),
                        content: document.body.innerText.substring(0, 1000), // First 1000 chars
                        // Add Facebook-specific selectors here when needed
                    };
                });

                console.log(`Successfully scraped: ${data.title}`);
                
                // Save the data
                await Actor.pushData(data);
                
            } catch (error) {
                console.error(`Error processing ${request.url}:`, error.message);
                
                // Save error info
                await Actor.pushData({
                    url: request.url,
                    error: error.message,
                    failed: true,
                    timestamp: new Date().toISOString()
                });
            }
        },
        failedRequestHandler: async ({ request, error }) => {
            console.error(`Request ${request.url} failed:`, error.message);
            
            // Save failed request info
            await Actor.pushData({
                url: request.url,
                error: error.message,
                failed: true,
                timestamp: new Date().toISOString()
            });
        },
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 60,
        maxConcurrency: 1, // Start with 1 to avoid rate limiting
    });

    // Add requests to the queue
    const requests = urls.map(url => ({ 
        url,
        uniqueKey: url 
    }));
    
    await crawler.addRequests(requests);
    
    // Run the crawler
    await crawler.run();
    
    console.log('Crawling completed successfully!');

} catch (error) {
    console.error('Actor failed:', error);
    throw error;
}

await Actor.exit();
