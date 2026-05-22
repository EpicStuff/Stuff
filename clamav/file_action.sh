#!/bin/bash
file="$2"

case "$1" in
	quarantine)
		quarantine_root='/etc/clamav/quarantine'

		if [[ -e "$file" ]]; then
			rel="${file#/}"
			dest="$quarantine_root/$rel"
			dest_dir="$(dirname "$dest")"

			install -d -m 0700 -o root -g root "$dest_dir"
			mv -- "$file" "$dest"
			chmod 0600 "$dest"
			logger -t clamav "Quarantined: $file -> $dest"
		fi
		;;
	delete)
		if [[ -e "$file" ]]; then
			rm -f -- "$file"
			logger -t clamav "Deleted: $file"
		fi
		;;
	*)
		echo "invalid action" >&2
		exit 2
		;;
esac
