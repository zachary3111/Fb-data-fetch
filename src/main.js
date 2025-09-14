import { Actor } from 'apify';
import { chromium } from 'playwright';

await Actor.init();

try {
    console.log('Actor started successfully!');
    
    const input = await Actor.getInput();
    console.log('Raw input:', input);

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

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`Processing URL ${i + 1}/${urls.length}: ${url}`);
            
            const page = await context.newPage();
            
            try {
                console.log(`Navigating to: ${url}`);
                
                // Try different strategies to access content
                const strategies = [
                    // Strategy 1: Try mobile Facebook (often less restrictive)
                    url.replace('www.facebook.com', 'm.facebook.com'),
                    // Strategy 2: Try adding fbclid parameter (sometimes helps)
                    url + (url.includes('?') ? '&' : '?') + 'fbclid=bypass',
                    // Strategy 3: Original URL
                    url
                ];

                let successData = null;
                
                for (const [strategyIndex, strategyUrl] of strategies.entries()) {
                    console.log(`Trying strategy ${strategyIndex + 1}: ${strategyUrl}`);
                    
                    try {
                        const response = await page.goto(strategyUrl, { 
                            waitUntil: 'domcontentloaded',
                            timeout: 30000 
                        });
                        
                        if (!response || !response.ok()) {
                            console.log(`Strategy ${strategyIndex + 1} failed: ${response?.status()}`);
                            continue;
                        }
                        
                        // Wait for content
                        await page.waitForTimeout(3000);
                        
                        // Check if we're on a login page
                        const isLoginPage = await page.evaluate(() => {
                            const loginIndicators = [
                                'input[name="email"]',
                                'input[name="pass"]', 
                                'Log In',
                                'Create new account'
                            ];
                            return loginIndicators.some(indicator => 
                                document.body.innerText.includes(indicator) || 
                                document.querySelector(indicator)
                            );
                        });
                        
                        if (isLoginPage) {
                            console.log(`Strategy ${strategyIndex + 1}: Login required`);
                            continue;
                        }
                        
                        // Extract data
                        const data = await page.evaluate(() => {
                            // Look for Facebook post content
                            const postSelectors = [
                                '[data-testid="post_message"]',
                                '[data-testid="post-content"]',
                                '.userContent',
                                '.story_body_container',
                                '[role="article"]'
                            ];
                            
                            let postContent = '';
                            for (const selector of postSelectors) {
                                const element = document.querySelector(selector);
                                if (element) {
                                    postContent = element.innerText;
                                    break;
                                }
                            }
                            
                            // Get all text content as fallback
                            const allText = document.body.innerText;
                            
                            return {
                                url: window.location.href,
                                title: document.title,
                                timestamp: new Date().toISOString(),
                                postContent: postContent || 'No post content found',
                                fullContent: allText.substring(0, 5000),
                                htmlLength: document.documentElement.innerHTML.length,
                                hasFacebookContent: document.querySelector('[data-testid]') !== null,
                                hasPostContent: postContent.length > 0,
                                strategy: strategyIndex + 1,
                                requiresLogin: allText.includes('Log In') || allText.includes('Create new account')
                            };
                        });
                        
                        if (!data.requiresLogin && data.hasPostContent) {
                            console.log(`Strategy ${strategyIndex + 1} SUCCESS: Found post content!`);
                            successData = data;
                            break;
                        } else if (!data.requiresLogin) {
                            console.log(`Strategy ${strategyIndex + 1}: No login required but limited content`);
                            successData = data; // Keep as backup
                        }
                        
                    } catch (error) {
                        console.log(`Strategy ${strategyIndex + 1} error:`, error.message);
                    }
                }
                
                // Save the best result we got
                if (successData) {
                    console.log(`Successfully scraped with strategy ${successData.strategy}`);
                    console.log(`Post content preview: ${successData.postContent.substring(0, 100)}...`);
                    await Actor.pushData(successData);
                } else {
                    // Save error info
                    await Actor.pushData({
                        url: url,
                        error: 'All strategies failed - content requires login',
                        failed: true,
                        timestamp: new Date().toISOString(),
                        strategiesTried: strategies.length
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
                await new Promise(resolve => setTimeout(resolve, 2000));
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
