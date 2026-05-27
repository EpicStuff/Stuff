function hand --wraps='nice -15 prime-run ghb & disown' --description 'alias hand=nice -15 prime-run ghb & disown'
	nice -15 prime-run ghb & disown $argv
end
