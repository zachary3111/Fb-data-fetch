# Use Playwright-enabled image. If running on Apify, their *-playwright images include browsers.
FROM apify/actor-node:22-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . ./
CMD ["node", "src/main.js"]