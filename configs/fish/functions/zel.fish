function zel --wraps='zellij attach -c main' --description 'alias zel=zellij attach -c main'
	zellij attach -c main $argv
end
