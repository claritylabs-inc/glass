FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN NPM_CONFIG_MIN_RELEASE_AGE=0 npm ci --include=optional
RUN set -eux; \
  native_tgz="$(NPM_CONFIG_MIN_RELEASE_AGE=0 npm pack @llamaindex/liteparse-linux-x64-gnu@2.0.3 --pack-destination /tmp)"; \
  mkdir -p node_modules/@llamaindex/liteparse-linux-x64-gnu; \
  tar -xzf "/tmp/${native_tgz}" -C node_modules/@llamaindex/liteparse-linux-x64-gnu --strip-components=1; \
  rm "/tmp/${native_tgz}"
ENV LD_LIBRARY_PATH=/app/node_modules/@llamaindex/liteparse-linux-x64-gnu

COPY . .
RUN npm run build --ignore-scripts
RUN node --input-type=module -e "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('@llamaindex/liteparse-linux-x64-gnu'); console.log('LiteParse Linux native package OK')"
RUN node -e "import('@llamaindex/liteparse').then(() => console.log('LiteParse native module OK'))"

CMD ["npm", "run", "start"]
