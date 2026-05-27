function fzf --description 'alias fzf=fzf --exact --walker=file,dir,hidden'
	command fzf --exact --walker=file,dir,hidden $argv
end
