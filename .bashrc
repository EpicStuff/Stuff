#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
PS1='\[\033[01;34m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]$ '
PS1="$PS1\[\e]1337;CurrentDir="'$(pwd)\a\]'

# custom
alias yayy='sudo true && yay --noconfirm'
alias apt='sudo pacman --noconfirm'
alias ctl='sudo SYSTEMD_EDITOR=micro systemctl'
alias btop='btop --utf-force'
alias logout='sudo pkill -u derek'
alias fetch='fastfetch --logo-padding-top 6'

source /usr/share/bash-complete-alias/complete_alias
complete -F _complete_alias "${!BASH_ALIASES[@]}"

bind '"\e[A":history-search-backward' # history with arrow up key
bind '"\e[B":history-search-forward' # history with arrow down key
