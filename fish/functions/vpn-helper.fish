function vpn-helper --description 'runs vpn in background'
	/opt/cisco/anyconnect/bin/vpnui
	systemctl stop vpnagentd.service
	# echo vpnagent stoped
end