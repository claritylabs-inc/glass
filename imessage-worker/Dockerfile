FROM node:22-trixie-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev --no-audit --no-fund --loglevel=error

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-trixie-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error \
  && npm cache clean --force --loglevel=error

COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
