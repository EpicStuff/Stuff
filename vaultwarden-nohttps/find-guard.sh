#!/bin/sh
# Dump candidate HTTPS / secure-context guards from the web-vault so the
# detect.txt + patch.sed patterns can be refined when a build changes shape.
#
# Usage:
#   ./find-guard.sh my-vaultwarden-container   # inspect a running container
#   ./find-guard.sh /path/to/extracted/web-vault
set -eu

T="${1:?usage: find-guard.sh <container-name|web-vault-path>}"

if [ -d "$T" ]; then
	DIR="$T"
	run() { sh -c "$1"; }
else
	DIR="/web-vault"
	run() { docker exec "$T" sh -c "$1"; }
fi

echo "=== token hits (file:line) ==="
run "grep -rEno 'isSecureContext|location\\.protocol|\\.protocol' '$DIR/app' | head -40" || true

echo
echo "=== context around any \"https:\" literal ==="
run "grep -rhEo '.{80}https:.{20}' '$DIR'/app/*.js | head -30" || true

echo
echo "=== context around isSecureContext ==="
run "grep -rhEo '.{60}isSecureContext.{40}' '$DIR'/app/*.js | head -30" || true
