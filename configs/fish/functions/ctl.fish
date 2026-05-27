function ctl --wraps='sudo SYSTEMD_EDITOR=micro systemctl' --description 'alias ctl=sudo SYSTEMD_EDITOR=micro systemctl'
	sudo SYSTEMD_EDITOR=micro systemctl $argv
end
