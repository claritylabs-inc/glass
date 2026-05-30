FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN NPM_CONFIG_MIN_RELEASE_AGE=0 npm ci

COPY . .
RUN npm run build --ignore-scripts
RUN node -e "import('@llamaindex/liteparse').then(() => console.log('LiteParse native module OK'))"

CMD ["npm", "run", "start"]
