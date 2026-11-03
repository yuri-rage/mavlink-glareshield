# MAVLink Glareshield Bridge Container
FROM python:3.12-slim

# Install OpenSSL for auto-TLS certificate generation and gosu for unprivileged execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged application user in dialout group (for USB serial access)
RUN groupadd -g 1000 glareshield && \
    useradd -u 1000 -g glareshield -G dialout -d /app -s /bin/bash glareshield && \
    mkdir -p /certs /app && \
    chown -R glareshield:glareshield /certs /app

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bridge script and entrypoint
COPY bridge.py entrypoint.sh ./
RUN chmod +x entrypoint.sh bridge.py

# Default ports: 56781 (WebSocket), 14550 (UDP telemetry)
EXPOSE 56781/tcp 14550/udp

# Volume mount for persistent TLS certificates
VOLUME ["/certs"]

ENV HOST=0.0.0.0 \
    PORT=56781 \
    MODE=udp \
    TARGET=0.0.0.0:14550 \
    AUTO_TLS=false \
    CERT_DIR=/certs \
    PYTHONUNBUFFERED=1

ENTRYPOINT ["/app/entrypoint.sh"]
