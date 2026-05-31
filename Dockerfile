FROM node:20-bookworm

WORKDIR /app

# Install dependencies first for better layer caching.
# node:20-bookworm ships python3/make/g++ which better-sqlite3 needs to compile.
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source (see .dockerignore for exclusions)
COPY . .

# Runtime defaults — override all of these at deploy time.
# Do NOT bake APP_PASSWORD / SESSION_SECRET / ENCRYPTION_KEY into the image.
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3456
ENV DATA_DIR=/data

# SQLite database and .secret key file live outside the image layer.
# Mount a named volume or host directory here so data survives restarts/re-deploys.
VOLUME ["/data"]

EXPOSE 3456

CMD ["node", "server.js"]
