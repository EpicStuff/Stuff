function rdp --description 'connects to the default uoft rdp with freerdp'
	if not systemctl is-active --quiet vpnagentd.service 
		vpn
		read -P "vpn started?"
	end
	xfreerdp3 /v:142.150.203.149 /u:qiderek@WIN /p:1qaz2wsx3edc4rfv5tgb6yhn7ujm /dynamic-resolution /drive:/home/derek,Z $argv
end
