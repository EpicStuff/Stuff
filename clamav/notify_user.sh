#!/bin/bash
file="$1"

alert="Signature detected by clamav: $2 in $file"

action="$(/usr/bin/notify-send -u critical -i dialog-warning \
	--action='quarantine=Quarantine' \
	--action='delete=Delete' \
	--wait \
	'Virus found!' "$alert")"

case "$action" in
	quarantine)
		/usr/bin/sudo -n /etc/clamav/file_action.sh quarantine "$file"
		;;
	delete)
		/usr/bin/sudo -n /etc/clamav/file_action.sh delete "$file"
		;;
	*)
		:
		;;
esac
