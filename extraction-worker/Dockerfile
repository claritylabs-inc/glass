FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    python3 \
    python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY package*.json ./
RUN NPM_CONFIG_MIN_RELEASE_AGE=0 npm ci

COPY . .
RUN npm run build --ignore-scripts

CMD ["npm", "run", "start"]
