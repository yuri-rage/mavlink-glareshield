#!/usr/bin/env bash
set -e

BRIDGE_SCRIPT="${BRIDGE_SCRIPT:-/app/bridge.py}"

# If user passed custom CLI arguments directly, execute them
if [ "$#" -gt 0 ] && [ "${1:0:1}" = "-" ]; then
    exec python3 "$BRIDGE_SCRIPT" "$@"
elif [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Configuration defaults
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-56781}"
MODE="${MODE:-udp}"
TARGET="${TARGET:-}"
CERT_DIR="${CERT_DIR:-/certs}"
AUTO_TLS="${AUTO_TLS:-false}"
CERT_CN="${CERT_CN:-}"

ARGS=("--host" "$HOST" "--port" "$PORT")

# Target defaults based on mode
if [ -z "$TARGET" ]; then
    case "$MODE" in
        udp) TARGET="0.0.0.0:14550" ;;
        tcp) TARGET="127.0.0.1:5760" ;;
        serial) TARGET="/dev/ttyUSB0:57600" ;;
    esac
fi

# Append Mode argument
case "$MODE" in
    mock)
        ARGS+=("--mock")
        ;;
    udp)
        ARGS+=("--udp" "$TARGET")
        ;;
    tcp)
        ARGS+=("--tcp" "$TARGET")
        ;;
    serial)
        ARGS+=("--serial" "$TARGET")
        ;;
    *)
        echo "[ERROR] Unknown MODE: $MODE (must be udp, tcp, serial, or mock)" >&2
        exit 1
        ;;
esac

# Auto-detect local network IP & hostname for zero-configuration TLS
DETECTED_IP=""
DETECTED_HOST=""
ALL_IPS=""

eval "$(python3 -c "
import socket
ips = set()
primary = ''
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('1.1.1.1', 80))
    primary = s.getsockname()[0]
    ips.add(primary)
    s.close()
except Exception:
    pass

host = ''
try:
    host = socket.gethostname()
    for info in socket.getaddrinfo(host, None, socket.AF_INET):
        ip = info[4][0]
        if not ip.startswith('127.'):
            ips.add(ip)
except Exception:
    pass

if not primary and ips:
    primary = sorted(list(ips))[0]

all_ips_str = ','.join(sorted(list(ips)))
print(f'DETECTED_IP=\"{primary}\"')
print(f'DETECTED_HOST=\"{host}\"')
print(f'ALL_IPS=\"{all_ips_str}\"')
")"

if [ -z "$CERT_CN" ]; then
    CERT_CN="${DETECTED_IP:-${DETECTED_HOST:-localhost}}"
fi

# Build Subject Alternative Names (SAN) for modern browser SSL validation
SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "$DETECTED_HOST" ] && [ "$DETECTED_HOST" != "localhost" ]; then
    SAN="$SAN,DNS:$DETECTED_HOST,DNS:$DETECTED_HOST.local"
fi

if [ -n "$ALL_IPS" ]; then
    IFS=',' read -ra IP_ARRAY <<< "$ALL_IPS"
    for ip in "${IP_ARRAY[@]}"; do
        if [ -n "$ip" ]; then
            SAN="$SAN,IP:$ip"
        fi
    done
fi

if [ -n "$CERT_CN" ] && [ "$CERT_CN" != "localhost" ] && [ "$CERT_CN" != "$DETECTED_HOST" ]; then
    if [[ "$CERT_CN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        if [[ ! ",$ALL_IPS," =~ ",$CERT_CN," ]]; then
            SAN="$SAN,IP:$CERT_CN"
        fi
    else
        SAN="$SAN,DNS:$CERT_CN"
    fi
fi

# Handle TLS / SSL Configuration
USE_TLS=false
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

if [ "$AUTO_TLS" = "true" ] || [ "$AUTO_TLS" = "1" ] || [ "$AUTO_TLS" = "yes" ]; then
    mkdir -p "$CERT_DIR"
    VALID_EXISTING=false

    if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
        if [[ "$CERT_CN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            if openssl x509 -in "$CERT_FILE" -text -noout 2>/dev/null | grep -q "IP Address:$CERT_CN"; then
                VALID_EXISTING=true
            fi
        else
            if openssl x509 -in "$CERT_FILE" -text -noout 2>/dev/null | grep -E -q "(DNS:$CERT_CN|CN\s*=\s*$CERT_CN)"; then
                VALID_EXISTING=true
            fi
        fi

        # Verify certificate hasn't expired
        if [ "$VALID_EXISTING" = "true" ]; then
            if ! openssl x509 -checkend 86400 -noout -in "$CERT_FILE" >/dev/null 2>&1; then
                echo "[TLS] Certificate in $CERT_DIR has expired or expires within 24h."
                VALID_EXISTING=false
            fi
        fi
    fi

    if [ "$VALID_EXISTING" = "true" ]; then
        echo "[TLS] Reusing valid existing TLS certificate in $CERT_DIR (covers $CERT_CN)"
    else
        echo "[TLS] Generating self-signed TLS certificate (CN=$CERT_CN)..."
        echo "[TLS] Certificate SANs: $SAN"
        openssl req -x509 -newkey rsa:2048 -nodes \
            -keyout "$KEY_FILE" \
            -out "$CERT_FILE" \
            -days 365 \
            -subj "/CN=$CERT_CN" \
            -addext "subjectAltName=$SAN"
        chmod 600 "$KEY_FILE"
        chmod 644 "$CERT_FILE"
        echo "[TLS] Certificate generated successfully in $CERT_DIR"
    fi
    USE_TLS=true
elif [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "[TLS] Existing TLS certificates detected in $CERT_DIR"
    USE_TLS=true
fi

if [ "$USE_TLS" = "true" ]; then
    ARGS+=("--ssl-cert" "$CERT_FILE" "--ssl-key" "$KEY_FILE")
    PROTOCOL="wss"
else
    PROTOCOL="ws"
fi

# Allowed Origins configuration
if [ "$ALLOW_ALL_ORIGINS" = "true" ] || [ "$ALLOW_ALL_ORIGINS" = "1" ]; then
    ARGS+=("--allow-all-origins")
fi

if [ "$ALLOW_NULL_ORIGIN" = "true" ] || [ "$ALLOW_NULL_ORIGIN" = "1" ]; then
    ARGS+=("--allow-null-origin")
fi

if [ -n "$ALLOW_ORIGINS" ]; then
    IFS=',' read -ra ORIGIN_LIST <<< "$ALLOW_ORIGINS"
    for origin in "${ORIGIN_LIST[@]}"; do
        trimmed=$(echo "$origin" | xargs)
        if [ -n "$trimmed" ]; then
            ARGS+=("--allow-origin" "$trimmed")
        fi
    done
fi

DISPLAY_HOST="${CERT_CN:-$HOST}"
if [ "$DISPLAY_HOST" = "0.0.0.0" ]; then
    DISPLAY_HOST="${DETECTED_IP:-localhost}"
fi

echo "============================================================"
echo " MAVLink Glareshield Bridge Container"
echo " Mode:       $MODE ($TARGET)"
echo " Protocol:   $PROTOCOL://$HOST:$PORT"
if [ "$USE_TLS" = "true" ]; then
    echo " TLS Active: true"
    echo " Connect at: wss://$DISPLAY_HOST:$PORT/"
else
    echo " TLS Active: false"
    echo " Connect at: ws://$DISPLAY_HOST:$PORT/"
fi
echo "============================================================"

exec python3 "$BRIDGE_SCRIPT" "${ARGS[@]}"
