# Small official Node 22 image
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package*.json ./
RUN npm ci --omit=dev

# Then copy the app code
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Don't run as root inside the container
USER node

# Docker runs this every 30 seconds to check the app still answers.
# If /api/health fails 3 times in a row, the container is marked "unhealthy".
# busybox wget comes with node:alpine, so no extra package is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-3000}/api/health" || exit 1

CMD ["node", "app.js"]