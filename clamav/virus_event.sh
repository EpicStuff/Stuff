#!/bin/bash
PATH=/usr/bin

# Send an alert to all graphical users.
for ADDRESS in /run/user/*; do
	USERID=${ADDRESS#/run/user/}
	/usr/bin/sudo -u "#$USERID" DBUS_SESSION_BUS_ADDRESS="unix:path=$ADDRESS/bus" PATH=${PATH} \
		/usr/bin/systemd-run --user --collect --quiet \
		/etc/clamav/notify_user.sh "${CLAM_VIRUSEVENT_FILENAME-}" "${CLAM_VIRUSEVENT_VIRUSNAME-}"
done
