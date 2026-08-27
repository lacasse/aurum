#!/bin/sh
set -e

CERT_DIR=/etc/nginx/certs
CERT=${CERT_DIR}/server.crt
KEY=${CERT_DIR}/server.key

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "Generating self-signed TLS certificate..."
    mkdir -p "$CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "$KEY" \
        -out "$CERT" \
        -days 3650 \
        -subj "/CN=aurum.local" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

exec nginx -g 'daemon off;'
