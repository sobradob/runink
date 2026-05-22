# syntax=docker/dockerfile:1.6
#
# RunInk image — Node 22 + Chromium (via Playwright) for server-side poster
# rendering. Based on the official Playwright image, which bundles the exact
# Chromium build used by the Playwright release and all required system deps.
#
# Why not node:slim + apt-get: installing Chromium's 60+ runtime deps by hand
# drifts every Playwright update. The official image is rebuilt for each
# Playwright release, so upgrading is a one-line version bump here.

# Pin to the Playwright release that matches our installed @playwright/test /
# playwright dependency. If you bump one, bump the other.
FROM mcr.microsoft.com/playwright:v1.50.0-jammy AS base

ENV NODE_ENV=production
WORKDIR /app

# Install deps separately to cache them across source changes.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Copy source and build the frontend + typecheck the server.
COPY . .
RUN npm run build

# Drop dev deps after build to keep the runtime image lean. (Kept tsx because
# `npm start` runs the TS server directly via `node --import tsx`.)
# tsx is listed under devDependencies, so we reinstall production-only after
# pruning and add tsx back explicitly as a runtime need.
RUN npm prune --omit=dev \
 && npm install --no-save tsx playwright

EXPOSE 8080

CMD ["npm", "start"]
