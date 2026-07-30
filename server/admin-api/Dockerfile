FROM python:3.13-alpine AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

FROM base AS test

COPY requirements-test.txt .
RUN pip install --no-cache-dir -r requirements-test.txt

COPY test_app.py .

CMD ["python", "-m", "unittest", "-v", "test_app.py"]

FROM base AS production

USER 1000:1000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
