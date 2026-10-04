function logout --wraps='sudo pkill -u derek' --description 'alias logout=sudo pkill -u derek'
	sudo pkill -u derek $argv
end
