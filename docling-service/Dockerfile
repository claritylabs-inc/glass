FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.12.0 torchvision==0.27.0 \
    && pip install --no-cache-dir -r requirements.txt

COPY server.py ./

EXPOSE 8080

CMD sh -c 'uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}'
