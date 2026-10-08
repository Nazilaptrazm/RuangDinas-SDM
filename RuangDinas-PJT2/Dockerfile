FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    DB_PATH=/data/sppd.db

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py index.py index.html app.js style.css ./
RUN mkdir -p /data && useradd --system --uid 10001 appuser \
    && chown -R appuser:appuser /app /data

USER appuser
EXPOSE 8000
CMD ["python", "app.py"]
