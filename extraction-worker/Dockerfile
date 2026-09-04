FROM node:24-trixie

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  tessdata_file="$(find /usr/share -name eng.traineddata -print -quit)"; \
  test -n "$tessdata_file"; \
  tessdata_dir="$(dirname "$tessdata_file")"; \
  ln -s "$tessdata_dir" /usr/share/liteparse-tessdata
ENV LITEPARSE_TESSDATA_PATH=/usr/share/liteparse-tessdata

COPY package*.json ./
RUN npm ci --include=optional --no-audit --no-fund --loglevel=error
RUN set -eux; \
  native_tgz="$(npm pack @llamaindex/liteparse-linux-x64-gnu@2.0.3 --pack-destination /tmp)"; \
  mkdir -p node_modules/@llamaindex/liteparse-linux-x64-gnu; \
  tar -xzf "/tmp/${native_tgz}" -C node_modules/@llamaindex/liteparse-linux-x64-gnu --strip-components=1; \
  rm "/tmp/${native_tgz}"
ENV LD_LIBRARY_PATH=/app/node_modules/@llamaindex/liteparse-linux-x64-gnu

COPY . .
RUN npm run build --ignore-scripts
RUN node --input-type=module -e "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('@llamaindex/liteparse-linux-x64-gnu'); console.log('LiteParse Linux native package OK')"
RUN node -e "import('@llamaindex/liteparse').then(() => console.log('LiteParse native module OK'))"

CMD ["node", "dist/index.js"]
