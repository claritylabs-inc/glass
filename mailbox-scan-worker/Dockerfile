FROM node:24-trixie-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY src ./src

CMD ["node", "src/index.js"]
