#!/usr/bin/env bash
set -e

BRIDGE_SCRIPT="${BRIDGE_SCRIPT:-/app/bridge.py}"

setup_serial_permissions() {
    if [ "$(id -u)" = "0" ] && id -u glareshield >/dev/null 2>&1; then
        local devs=()
        if [ "$MODE" = "serial" ] && [ -n "$TARGET" ]; then
            if [ -e "$TARGET" ]; then
                devs+=("$TARGET")
            else
                devs+=("${TARGET%:*}")
            fi
        fi
        devs+=(/dev/ttyUSB0 /dev/ttyACM0)
        for dev in "${devs[@]}"; do
            if [ -n "$dev" ] && [ -e "$dev" ]; then
                local dev_gid
                dev_gid=$(stat -c '%g' "$dev" 2>/dev/null || true)
                if [ -n "$dev_gid" ] && [ "$dev_gid" != "0" ]; then
                    if ! id -G glareshield 2>/dev/null | grep -qw "$dev_gid"; then
                        groupadd -g "$dev_gid" "host_serial_$dev_gid" 2>/dev/null || true
                        usermod -a -G "$dev_gid" glareshield 2>/dev/null || true
                    fi
                fi
            fi
        done
    fi
}

run_bridge() {
    setup_serial_permissions
    if [ "$(id -u)" = "0" ] && id -u glareshield >/dev/null 2>&1 && command -v gosu >/dev/null 2>&1; then
        exec gosu glareshield python3 -u "$BRIDGE_SCRIPT" "$@"
    else
        exec python3 -u "$BRIDGE_SCRIPT" "$@"
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

# One value per line, read as data (never evaluated as shell: a hostname can't run code here).
{ read -r DETECTED_IP; read -r DETECTED_HOST; read -r ALL_IPS; } < <(python3 -c "
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
print(primary)
print(host)
print(all_ips_str)
") || true  # nothing detected: the defaults below

# Names that go into the certificate: a hostname or an IP, nothing else (a "/" would add subject fields, a ","
# subjectAltName entries). An odd detected hostname is skipped; an odd CERT_CN is an error.
valid_name() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]]; }
if [ -n "$DETECTED_HOST" ] && ! valid_name "$DETECTED_HOST"; then
    echo "[TLS] Skipping hostname '$DETECTED_HOST' in the certificate (not a plain hostname)"
    DETECTED_HOST=""
fi
if [ -n "$CERT_CN" ] && ! valid_name "$CERT_CN"; then
    echo "[ERROR] CERT_CN='$CERT_CN' is not a hostname or IP address" >&2
    exit 1
fi

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
RUN_CERT_DIR="/tmp/glareshield_certs"
mkdir -p "$RUN_CERT_DIR"

if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
    echo "[TLS] Reusing existing certificates found in $CERT_DIR"
    cp "$CERT_DIR/cert.pem" "$RUN_CERT_DIR/cert.pem"
    cp "$CERT_DIR/key.pem" "$RUN_CERT_DIR/key.pem"
    chmod 644 "$RUN_CERT_DIR/cert.pem"
    chmod 600 "$RUN_CERT_DIR/key.pem"
    chown -R glareshield:glareshield "$RUN_CERT_DIR" 2>/dev/null || true
    CERT_FILE="$RUN_CERT_DIR/cert.pem"
    KEY_FILE="$RUN_CERT_DIR/key.pem"
    USE_TLS=true
elif [ "$AUTO_TLS" = "true" ] || [ "$AUTO_TLS" = "1" ] || [ "$AUTO_TLS" = "yes" ]; then
    echo "[TLS] Generating self-signed TLS certificate (CN=$CERT_CN)..."
    echo "[TLS] Certificate SANs: $SAN"
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$RUN_CERT_DIR/key.pem" \
        -out "$RUN_CERT_DIR/cert.pem" \
        -days 365 \
        -subj "/CN=$CERT_CN" \
        -addext "subjectAltName=$SAN"
    chmod 644 "$RUN_CERT_DIR/cert.pem"
    chmod 600 "$RUN_CERT_DIR/key.pem"
    chown -R glareshield:glareshield "$RUN_CERT_DIR" 2>/dev/null || true

    # Persist to mounted volume without modifying host permissions
    if mkdir -p "$CERT_DIR" 2>/dev/null && [ -w "$CERT_DIR" ]; then
        cp "$RUN_CERT_DIR/cert.pem" "$CERT_DIR/cert.pem" 2>/dev/null || true
        cp "$RUN_CERT_DIR/key.pem" "$CERT_DIR/key.pem" 2>/dev/null || true
        # The private key: readable by the owner of the certs folder (on the host, usually you) and no one else.
        chmod 600 "$CERT_DIR/key.pem" 2>/dev/null || true
        chown --reference="$CERT_DIR" "$CERT_DIR/key.pem" "$CERT_DIR/cert.pem" 2>/dev/null || true
        echo "[TLS] Certificate saved to $CERT_DIR for persistence"
    fi

    CERT_FILE="$RUN_CERT_DIR/cert.pem"
    KEY_FILE="$RUN_CERT_DIR/key.pem"
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

# Pairing token: every device needs it to connect (anyone else on the network could otherwise command the
# vehicle). TOKEN empty: the one saved in $CERT_DIR/token, or a new one saved there. TOKEN=<passphrase>: that.
# TOKEN=off: no token (anyone who can reach the port can connect).
TOKEN="${TOKEN:-}"
TOKEN_FILE="$CERT_DIR/token"
TOKEN_NOTE=""
case "${TOKEN,,}" in
    off | false | no | none | 0)
        TOKEN=""
        TOKEN_NOTE="OFF (TOKEN=off): anyone who can reach port $PORT can connect"
        ;;
    "")
        if [ -s "$TOKEN_FILE" ]; then
            TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
            TOKEN_NOTE="from $TOKEN_FILE"
        else
            TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(16))')"
            if (umask 077 && printf '%s\n' "$TOKEN" > "$TOKEN_FILE") 2>/dev/null; then
                chown --reference="$CERT_DIR" "$TOKEN_FILE" 2>/dev/null || true
                TOKEN_NOTE="new, saved in $TOKEN_FILE (delete it and restart to change it)"
            else
                TOKEN_NOTE="new, NOT saved ($CERT_DIR isn't writable): it changes on every restart"
            fi
        fi
        ;;
    *)
        TOKEN_NOTE="from TOKEN"
        if [ "${#TOKEN}" -lt 12 ]; then
            echo "[WARN] TOKEN is under 12 characters: easy to guess for anyone on your network"
        fi
        ;;
esac
if [ -n "$TOKEN" ]; then
    # To the bridge by environment, not the command line (where any process could read it).
    export BRIDGE_TOKEN="$TOKEN"
    ARGS+=("--pair-host" "$DISPLAY_HOST")
    # The QR code as an image too. Created here (the bridge runs as an unprivileged user); owner-only: it holds
    # the token.
    if install -m 600 -o glareshield /dev/null "$CERT_DIR/pair.svg" 2>/dev/null; then
        ARGS+=("--pair-svg" "$CERT_DIR/pair.svg")
    fi
else
    unset BRIDGE_TOKEN
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
echo " Token:      $TOKEN_NOTE"
if [ -n "$TOKEN" ]; then
    echo "             Pair each device with the QR code below (or the link under it)."
fi
echo "============================================================"

run_bridge "${ARGS[@]}"
