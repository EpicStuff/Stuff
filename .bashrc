#
# ~/.bashrc
#

# default
# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto -a'
alias grep='grep --color=auto'

# stuff
PS1="\[\e[34m\]\u\[\e[m\]\[\e[37m\]@\[\e[m\]\[\e[31m\]\h\[\e[m\]\[\e[37m\]: \[\e[m\]\[\e[36m\]\w\[\e[m\]\[\e[37m\]\\$\[\e[m\] "
PS1="$PS1\[\e]1337;CurrentDir="'$(pwd)\a\]'
HISTCONTROL=ignoreboth:erasedups  # ignore both concurrent and not concurrent duplicates and commands that start with space
shopt -s histappend  # make history append instead of overwrite
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}history -a; history -c; history -r"  # After each command, append to the history file and reread it
source /usr/share/blesh/ble.sh --noattach --rcfile /home/derek/Seafile/Sync/home/.blerc # activate ble.sh
eval "$(atuin init bash --disable-up-arrow)" # activate atuin
bind '"\e[A":history-search-backward' # history with arrow up key
bind '"\e[B":history-search-forward' # history with arrow down key

# aliases + autocomplete
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
# alias zel='zellij attach -c main'
alias zel='bash <(curl -L https://zellij.dev/launch) attach -c main'
alias py='python'
alias hand='nice -15 prime-run ghb & disown'
alias resolve='prime-run /opt/resolve/bin/resolve & disown'  
alias fzf='fzf --exact --walker=file,dir,hidden'
alias java8='/usr/lib/jvm/java-8-openjdk/jre/bin/java'
alias java23='/usr/lib/jvm/java-23-openjdk/bin/java'
alias vibe='vibe --model /home/derek/.local/share/github.com.thewh1teagle.vibe/ggml-distil-large-v3_1.bin'

source /usr/share/bash-complete-alias/complete_alias
complete -F _complete_alias "${!BASH_ALIASES[@]}"

# variables
export EDITOR=micro

# xdg-ninja
export XDG_DATA_HOME="$HOME"/.local/share
export XDG_CONFIG_HOME="$HOME"/.config
export XDG_STATE_HOME="$HOME"/.local/state
export XDG_CACHE_HOME="$HOME"/.cache

export ANDROID_USER_HOME="$XDG_DATA_HOME"/android
alias adb='HOME="$XDG_DATA_HOME"/android adb'
export HISTFILE="${XDG_STATE_HOME}"/bash_history
export DOCKER_CONFIG="$XDG_CONFIG_HOME"/docker
export CUDA_CACHE_PATH="$XDG_CACHE_HOME"/nv
export GNUPGHOME="$XDG_DATA_HOME"/gnupg
export GTK2_RC_FILES="$XDG_CONFIG_HOME"/gtk-2.0/gtkrc
export IPYTHONDIR="$XDG_CONFIG_HOME/ipython"
export JUPYTER_CONFIG_DIR="$XDG_CONFIG_HOME"/jupyter
export NIMBLE_DIR="$XDG_DATA_HOME/nimble"
export _JAVA_OPTIONS=-Djava.util.prefs.userRoot="$XDG_CONFIG_HOME"/java
export PYTHONSTARTUP="$XDG_CONFIG_HOME"/python/pythonrc
alias wget=wget --hsts-file="$XDG_DATA_HOME/wget-hsts"
export WINEPREFIX="$XDG_DATA_HOME"/wine
# export NPM_CONFIG_INIT_MODULE="$XDG_CONFIG_HOME"/npm/config/npm-init.js
# export NPM_CONFIG_CACHE="$XDG_CACHE_HOME"/npm
# export NPM_CONFIG_TMP="$XDG_RUNTIME_DIR"/npm
export NPM_CONFIG_USERCONFIG="$XDG_CONFIG_HOME"/npm/npmrc
# Created by `pipx` on 2024-10-14 22:41:06
export PATH="$PATH:/home/derek/.local/bin"
export CCNET_CONF_DIR="$XDG_DATA_HOME"/ccnet

eval "$(zoxide init bash)"

# activate zellij if on server
if [[ -z "$ZELLIJ" && "$(hostname)" = "server" ]]; then
    # zellij attach -c main
	bash <(curl -L https://zellij.dev/launch) attach -c main
fi

[[ ! ${BLE_VERSION-} ]] || ble-attach
