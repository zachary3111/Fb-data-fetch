# Use the correct Apify base image with Playwright and all browsers
FROM apify/actor-node-playwright:latest

# Copy package files
COPY --chown=myuser:myuser package*.json ./

# Install dependencies
RUN npm --quiet set progress=false \
    && npm install --only=prod --no-optional \
    && echo "Installed NPM packages:" \
    && (npm list --only=prod --no-optional --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy source code
COPY --chown=myuser:myuser . ./

# The container will run as 'myuser' (non-root) by default
