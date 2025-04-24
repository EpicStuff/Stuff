function vpn --description 'runs cisco vpn'
	if not systemctl is-active --quiet vpnagentd.service 	
		ctl start vpnagentd.service
	end
	wl-copy qiderek
	# echo running vpn helper
	fish -c vpn-helper & disown
	# echo vpn helper disowned
end
