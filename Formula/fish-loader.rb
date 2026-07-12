class FishLoader < Formula
	desc 'Load Homebrew Fish files'
	homepage 'https://codeberg.org/EpicStuff/stuff'
	url 'https://raw.githubusercontent.com/Homebrew/brew/34c40c18ffa2029b611b61c73273e32c003d0842/Library/Homebrew/.ruby-version', using: :nounzip
	sha256 '2e9fe584010a41f374317eb891684ccaab818403e8fa8eb7b2053c1810a8c00a'
	license 'MIT'
	version '1.0.0'

	def install
		(prefix/'fish-loader.fish').write <<~FISH
			set -l homebrew_fish_share '#{HOMEBREW_PREFIX}/share/fish'

			contains $homebrew_fish_share/vendor_functions.d $fish_function_path; or set -ga fish_function_path $homebrew_fish_share/vendor_functions.d
			contains $homebrew_fish_share/vendor_completions.d $fish_complete_path; or set -ga fish_complete_path $homebrew_fish_share/vendor_completions.d

			if test -d $homebrew_fish_share/vendor_conf.d
				for file in $homebrew_fish_share/vendor_conf.d/*.fish
					source $file
				end
			end
		FISH

		ohai 'Enable Homebrew Fish packages', <<~EOS
			mkdir -p ~/.config/fish/conf.d
			ln -s '#{opt_prefix}/fish-loader.fish' ~/.config/fish/conf.d/homebrew-loader.fish

			Make sure to remove ~/.config/fish/conf.d/homebrew-loader.fish before uninstalling.
		EOS
	end

	def caveats
		<<~EOS
			Enable Homebrew Fish vendor files:
			  mkdir -p ~/.config/fish/conf.d
			  ln -s '#{opt_prefix}/fish-loader.fish' ~/.config/fish/conf.d/homebrew-loader.fish

			Then restart Fish:
			  exec /usr/bin/fish -l

			Make sure to remove ~/.config/fish/conf.d/homebrew-loader.fish before uninstalling.
		EOS
	end

	test do
		loader = prefix/'fish-loader.fish'

		assert_path_exists loader
		assert_match "#{HOMEBREW_PREFIX}/share/fish", loader.read
		assert_match 'vendor_functions.d', loader.read
		assert_match 'vendor_completions.d', loader.read
		assert_match 'vendor_conf.d', loader.read
	end
end