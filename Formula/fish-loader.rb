require_relative '../lib/formula_sandbox_access'

class FishLoader < Formula
	desc 'Load Homebrew Fish files'
	homepage 'https://codeberg.org/EpicStuff/stuff'
	url 'https://raw.githubusercontent.com/Homebrew/brew/34c40c18ffa2029b611b61c73273e32c003d0842/Library/Homebrew/.ruby-version', using: :nounzip
	sha256 '2e9fe584010a41f374317eb891684ccaab818403e8fa8eb7b2053c1810a8c00a'
	license 'MIT'
	version '1.1.2'

	livecheck do
		skip 'No upstream'
	end

	def install
		(prefix/'fish-loader.fish').write <<~FISH
			set -l homebrew_fish_share '#{HOMEBREW_PREFIX}/share/fish'

			# Return a search path ordered as: user directories, Homebrew directory, system directories.
			function __homebrew_order_fish_path
				set -l homebrew_directory $argv[1]
				set -e argv[1]

				set -l user_directories
				set -l system_directories

				for directory in $argv
					# Remove the existing Homebrew entry before inserting it again.
					if test $directory = $homebrew_directory
						continue
					end

					# Directories below $HOME are user directories.
					if string match -q -- "$HOME/*" $directory
						set -a user_directories $directory
					else
						set -a system_directories $directory
					end
				end

				printf '%s\n' $user_directories $homebrew_directory $system_directories
			end

			# Make user functions/completions override Homebrew functions and Homebrew functions override system functions.
			set -g fish_function_path (__homebrew_order_fish_path $homebrew_fish_share/vendor_functions.d $fish_function_path)
			set -g fish_complete_path (__homebrew_order_fish_path $homebrew_fish_share/vendor_completions.d $fish_complete_path)

			# Cleanup, the helper is only needed for this loader.
			functions --erase __homebrew_order_fish_path

			# Fish has no configurable search path for conf.d files,
			# so source Homebrew vendor configuration files directly.
			if test -d $homebrew_fish_share/vendor_conf.d
				for file in (command find -L $homebrew_fish_share/vendor_conf.d -maxdepth 1 -type f -name '*.fish' | sort)
					source $file
				end
			end
		FISH

		install_loader_link
	end

	def caveats
		<<~EOS
			The Homebrew Fish loader is enabled at:
			  ~/.config/fish/conf.d/homebrew-loader.fish

			It will be loaded by new Fish sessions.

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

	private

	def install_loader_link
		config_dir = Pathname(Dir.home)/'.config/fish/conf.d'
		loader = config_dir/'homebrew-loader.fish'
		target = opt_prefix/'fish-loader.fish'

		config_dir.mkpath

		if loader.symlink?
			return if loader.readlink == target

			odie "Refusing to overwrite existing symlink: #{loader} -> #{loader.readlink}"
		end
		odie "Refusing to overwrite existing path: #{loader}" if loader.exist?

		ln_s target, loader
	end
end
