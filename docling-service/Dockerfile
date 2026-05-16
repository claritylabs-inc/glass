FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DOCLING_UPSTREAM=http://127.0.0.1:5001 \
    PORT=8080

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./

EXPOSE 8080

CMD sh -c 'docling-serve run --host 127.0.0.1 --port 5001 & uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}'
