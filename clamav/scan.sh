#!/usr/bin/env bash
set -o pipefail

clamscan -r -i \
	--exclude-dir='^/proc/' \
	--exclude-dir='^/sys/' \
	--exclude-dir='^/dev/' \
	--exclude-dir='^/run/' \
	--exclude-dir='^/mnt/' \
	--exclude-dir='^/run/media/' \
	/ 2>&1 | logger -t clamav_scan

rc="${PIPESTATUS[0]}"

# 0 clean, 1 infected found, 2 error
if [ "$rc" -eq 2 ]; then
	exit 2
fi
exit 0
