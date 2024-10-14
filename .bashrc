#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
PS1="\[\e[34m\]\u\[\e[m\]\[\e[37m\]@\[\e[m\]\[\e[31m\]\h\[\e[m\]\[\e[37m\]: \[\e[m\]\[\e[36m\]\w\[\e[m\]\[\e[37m\]\\$\[\e[m\] "
PS1="$PS1\[\e]1337;CurrentDir="'$(pwd)\a\]'

# custom
alias sudo='sudo '
alias yayy='sudo -v && yay --noconfirm --sudoloop'
alias yayy-f='yayy  --overwrite '"'"'*'"'"''
alias apt='sudo pacman --noconfirm'
alias ctl='sudo SYSTEMD_EDITOR=micro systemctl'
alias btop='btop --utf-force'
alias logout='sudo pkill -u derek'
alias fetch='fastfetch --logo-padding-top 6'
alias edit='micro'
alias dockerc='docker compose'
alias dockerc-up='docker compose up -d && docker compose logs -f'
alias fpaq='zpaqfranz'
alias zel='zellij options --attach-to-session true --session-name main'
alias py='python'
alias hand='nice -15 ghb & disown'

source /usr/share/bash-complete-alias/complete_alias
complete -F _complete_alias "${!BASH_ALIASES[@]}"

bind '"\e[A":history-search-backward' # history with arrow up key
bind '"\e[B":history-search-forward' # history with arrow down key

export EDITOR=micro
HISTCONTROL=ignoreboth

# xdg-ninja
export XDG_DATA_HOME="$HOME"/.local/share
export XDG_CONFIG_HOME="$HOME"/.config
export XDG_STATE_HOME="$HOME"/.local/state
export XDG_CACHE_HOME="$HOME"/.cache

export ANDROID_USER_HOME="$XDG_DATA_HOME"/android
alias adb='HOME="$XDG_DATA_HOME"/android adb'
export HISTFILE="${XDG_STATE_HOME}"/bash/history
export CUDA_CACHE_PATH="$XDG_CACHE_HOME"/nv
export GNUPGHOME="$XDG_DATA_HOME"/gnupg
export GTK2_RC_FILES="$XDG_CONFIG_HOME"/gtk-2.0/gtkrc
export IPYTHONDIR="$XDG_CONFIG_HOME/ipython"
export JUPYTER_CONFIG_DIR="$XDG_CONFIG_HOME"/jupyter
export NIMBLE_DIR="$XDG_DATA_HOME/nimble"
export _JAVA_OPTIONS=-Djava.util.prefs.userRoot="$XDG_CONFIG_HOME"/java
export PYTHONSTARTUP="$XDG_CONFIG_HOME"/python/pythonrc
export INPUTRC="$XDG_CONFIG_HOME"/readline/inputrc
alias wget=wget --hsts-file="$XDG_DATA_HOME/wget-hsts"
export WINEPREFIX="$XDG_DATA_HOME"/wine

# zellij
if [[ -z "$ZELLIJ" && "$(hostname)" = "server" ]]; then
    zellij options --attach-to-session true --session-name main
fi
