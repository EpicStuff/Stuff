#!/bin/sh
# Strip the web-vault's HTTPS / secure-context guard so it loads over plain
# http (e.g. through an SSH tunnel to 127.0.0.1). Encryption still works
# because loopback is already a "secure context", so crypto.subtle is live —
# only this JS guard stands in the way.
#
# Fail-loud by design: if the guard isn't found before patching, or is still
# present after, the script exits non-zero and the docker build FAILS. That
# way a web-vault update that reshapes the guard breaks the build instead of
# silently shipping a locked-out vault.
set -eu

WEB_VAULT="${1:-/web-vault}"
APP="$WEB_VAULT/app"
HERE="$(dirname "$0")"

[ -d "$APP" ] || { echo "patch: $APP not found" >&2; exit 1; }

# --- pre-check: the guard must be present, or our patterns are stale --------
before="$(grep -rhE -f "$HERE/detect.txt" "$APP" 2>/dev/null | wc -l)"
if [ "$before" -eq 0 ]; then
	echo "patch: no known HTTPS guard found in $APP." >&2
	echo "       The web-vault build likely changed shape." >&2
	echo "       Run find-guard.sh against the image and update" >&2
	echo "       detect.txt + patch.sed, then rebuild." >&2
	exit 1
fi
echo "patch: found $before guard reference(s), patching…"

# --- patch the JS guard -----------------------------------------------------
find "$APP" -name '*.js' -exec sed -E -i -f "$HERE/patch.sed" {} +

# --- strip Subresource-Integrity so edited bundles aren't rejected ----------
find "$WEB_VAULT" -name '*.html' -exec sed -E -i -f "$HERE/patch-html.sed" {} +

# --- drop any precompressed siblings so the edited plain file is served -----
# (Vaultwarden compresses on the fly; stale .gz/.br would otherwise win.)
find "$APP" \( -name '*.js.gz' -o -name '*.js.br' \) -delete 2>/dev/null || true

# --- post-check: the guard must be gone -------------------------------------
after="$(grep -rhE -f "$HERE/detect.txt" "$APP" 2>/dev/null | wc -l)"
if [ "$after" -ne 0 ]; then
	echo "patch: $after guard reference(s) survived — patterns matched" >&2
	echo "       detection but not substitution. Refine patch.sed." >&2
	exit 1
fi
echo "patch: done — guard removed, integrity stripped."
