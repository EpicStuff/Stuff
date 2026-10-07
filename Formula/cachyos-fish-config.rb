class CachyosFishConfig < Formula
	desc 'Fish configuration used by CachyOS'
	homepage 'https://github.com/CachyOS/cachyos-fish-config'
	url 'https://github.com/CachyOS/cachyos-fish-config/archive/refs/tags/v16.tar.gz'
	sha256 '97a0b603f393be3422465ff9e18f2d03ccfc33657b672de6ba89b3a3ac3b473d'

	livecheck do
		url 'https://github.com/CachyOS/cachyos-fish-config.git'
		regex(/^v?(\d+)$/i)
		strategy :git
	end

	depends_on 'epic/stuff/fish-loader'

	def install
		inreplace 'cachyos-config.fish', '/usr/share/cachyos-fish-config/conf.d/done.fish', "#{opt_prefix}/done.fish"

		prefix.install 'conf.d/done.fish'
		(share/'fish/vendor_conf.d').install 'cachyos-config.fish'
	end

	def command_available?(command)
		ENV.fetch('PATH', '').split(File::PATH_SEPARATOR).any? do |directory|
			path = Pathname(directory)/command
			path.file? && path.executable?
		end
	end

	def caveats
		message = []

		commands = {
			'bat' => 'bat',
			'expac' => 'expac',
			'eza' => 'eza',
			'fastfetch' => 'fastfetch',
			'fish' => 'fish',
			'fzf' => 'fzf',
			'pkgfile' => 'pkgfile',
			'tealdeer' => 'tldr',
		}

		missing = commands.filter_map do |package, command|
			package unless command_available?(command)
		end

		if File.exist?('/etc/arch-release')
			unless missing.empty?
				message << <<~EOS
					Install the missing packages expected by this configuration:
					  yay -S #{missing.join(' ')}
				EOS
			end
		elsif File.exist?('/etc/debian_version')
			debian_missing = missing - %w[expac pkgfile]

			if missing.include?('bat') && command_available?('batcat')
				debian_missing.delete('bat')
			end

			unless debian_missing.empty?
				message << <<~EOS
					Install the missing packages expected by this configuration:
					  sudo apt install #{debian_missing.join(' ')}
				EOS
			end

			if !command_available?('bat') && command_available?('batcat')
				message << <<~EOS
					Debian provides bat as batcat. Create the expected command:
					  mkdir -p ~/.local/bin
					  ln -s /usr/bin/batcat ~/.local/bin/bat
				EOS
			elsif missing.include?('bat')
				message << <<~EOS
					After installing bat, create the expected command:
					  mkdir -p ~/.local/bin
					  ln -s /usr/bin/batcat ~/.local/bin/bat
				EOS
			end

			arch_only = missing & %w[expac pkgfile]

			unless arch_only.empty?
				message << "#{arch_only.join(' and ')} are Arch specific, so aliases using them will not work on Debian."
			end
		else
			message << <<~EOS
				This configuration expects several CachyOS utilities, including
				fastfetch, bat, eza, expac, fzf, pkgfile, and tealdeer.
			EOS
		end

		message.join("\n")
	end

	test do
		config = share/'fish/vendor_conf.d/cachyos-config.fish'
		done = prefix/'done.fish'

		assert_path_exists config
		assert_path_exists done
		assert_match opt_prefix.to_s, config.read
		assert_match '__done_version', done.read
	end
end