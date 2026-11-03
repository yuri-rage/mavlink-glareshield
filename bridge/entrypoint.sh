#!/usr/bin/env bash
set -e

BRIDGE_SCRIPT="${BRIDGE_SCRIPT:-/app/bridge.py}"

run_bridge() {
    if [ "$(id -u)" = "0" ] && id -u glareshield >/dev/null 2>&1 && command -v gosu >/dev/null 2>&1; then
        chown -R glareshield:glareshield "$CERT_DIR" 2>/dev/null || true
        exec gosu glareshield python3 "$BRIDGE_SCRIPT" "$@"
    else
        exec python3 "$BRIDGE_SCRIPT" "$@"
    fi
}

# If user passed custom CLI arguments directly, execute them (defaulting host to 0.0.0.0 if not specified)
if [ "$#" -gt 0 ] && [ "${1:0:1}" = "-" ]; then
    HAS_HOST=false
    for arg in "$@"; do
        if [ "$arg" = "--host" ] || [[ "$arg" == --host=* ]]; then
            HAS_HOST=true
            break
        fi
    done
    EXTRA_ARGS=()
    if [ "$HAS_HOST" = "false" ]; then
        EXTRA_ARGS=("--host" "${HOST:-0.0.0.0}")
    fi
    run_bridge "${EXTRA_ARGS[@]}" "$@"
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
import socket, struct, fcntl, array
ips = set()
primary = ''

# 1. Enumerate network interfaces via ioctl (offline / no gateway needed)
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    buf = array.array('B', b'\0' * 4096)
    ifconf = struct.pack('iP', 4096, buf.buffer_info()[0])
    res = fcntl.ioctl(s.fileno(), 0x8912, ifconf)
    size, _ = struct.unpack('iP', res)
    raw = buf.tobytes()[:size]
    for i in range(0, size, 40):
        ifname = raw[i:i+16].split(b'\0', 1)[0].decode()
        ip = socket.inet_ntoa(raw[i+20:i+24])
        if not ip.startswith('127.'):
            ips.add(ip)
            if not primary and not ifname.startswith(('docker', 'br-', 'veth')):
                primary = ip
    s.close()
except Exception:
    pass

# 2. Kernel route lookup (if outbound gateway is available)
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('1.1.1.1', 80))
    gw_ip = s.getsockname()[0]
    if not gw_ip.startswith('127.'):
        ips.add(gw_ip)
        primary = gw_ip
    s.close()
except Exception:
    pass

# 3. Hostname resolution
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

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "[TLS] Reusing existing certificates found in $CERT_DIR"
    USE_TLS=true
elif [ "$AUTO_TLS" = "true" ] || [ "$AUTO_TLS" = "1" ] || [ "$AUTO_TLS" = "yes" ]; then
    mkdir -p "$CERT_DIR"
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

run_bridge "${ARGS[@]}"
