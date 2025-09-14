import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';

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

    // Your existing crawler logic here...
    const crawler = new PuppeteerCrawler({
        requestHandler: async ({ page, request }) => {
            console.log(`Processing: ${request.url}`);
            
            // Wait for page to load
            await page.waitForSelector('body', { timeout: 30000 });
            
            // Extract data - customize this based on what you want to scrape
            const data = await page.evaluate(() => {
                return {
                    url: window.location.href,
                    title: document.title,
                    // Add more extraction logic here
                };
            });

            // Save the data
            await Actor.pushData(data);
        },
        failedRequestHandler: async ({ request }) => {
            console.log(`Request ${request.url} failed`);
        },
    });

    // Run the crawler
    await crawler.run(urls.map(url => ({ url })));

} catch (error) {
    console.error('Actor failed:', error);
    throw error;
}

await Actor.exit();
