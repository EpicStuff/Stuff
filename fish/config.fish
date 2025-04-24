source /usr/share/cachyos-fish-config/cachyos-config.fish

function fish_greeting
	fetch
end

if status is-interactive
	# Commands to run in interactive sessions can go here
	atuin init --disable-up-arrow fish | source
	zoxide init fish | source

	# enable user and hostname always
	set SSH_CONNECTION = yes 

	# abbreviations
	abbr -a ctl 'sudo SYSTEMD_EDITOR=micro systemctl'
end
