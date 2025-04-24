function yayy --wraps='sudo -v && yay --noconfirm --sudoloop' --description 'alias yayy=sudo -v && yay --noconfirm --sudoloop'
  sudo true && yay --noconfirm --sudoloop $argv
        
end
