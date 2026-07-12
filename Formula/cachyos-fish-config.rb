class CachyosFishConfig < Formula
	desc 'Fish configuration used by CachyOS'
	homepage 'https://github.com/CachyOS/cachyos-fish-config'
	url 'https://github.com/CachyOS/cachyos-fish-config/archive/refs/tags/v16.tar.gz'
	sha256 '97a0b603f393be3422465ff9e18f2d03ccfc33657b672de6ba89b3a3ac3b473d'
	license 'MIT'
	head 'https://github.com/CachyOS/cachyos-fish-config.git', branch: 'main'

	livecheck do
		url 'https://github.com/CachyOS/cachyos-fish-config.git'
		regex(/^v?(\d+)$/i)
		strategy :git
	end

	def install
		inreplace 'cachyos-config.fish', '/usr/share/cachyos-fish-config/conf.d/done.fish', "#{opt_prefix}/done.fish"

		prefix.install 'cachyos-config.fish'
		prefix.install 'conf.d/done.fish'
	end

	def command_available?(command)
		ENV.fetch('PATH', '').split(File::PATH_SEPARATOR).any? do |directory|
			path = Pathname(directory)/command
			path.file? && path.executable?
		end
	end

	def caveats
		home = Pathname(ENV.fetch('HOME'))
		link = home/'.config/fish/conf.d/cachyos-config.fish'
		display_link = '~/.config/fish/conf.d/cachyos-config.fish'
		target = opt_prefix/'cachyos-config.fish'
		message = []

	if link.exist? || link.symlink?
		message << <<~EOS
			Warning: #{display_link} already exists and will be replaced.
		EOS
	end

	message << <<~EOS
		Enable with:
		  mkdir -p ~/.config/fish/conf.d
		  ln -fs '#{target}' #{display_link}

		Make sure to remove #{display_link} before uninstalling.
	EOS

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
					  yay -S --needed #{missing.join(' ')}
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

			unless command_available?('bat')
				message << <<~EOS
					Debian provides the bat command as batcat. Create the expected command:
					  mkdir -p ~/.local/bin
					  ln -sf /usr/bin/batcat ~/.local/bin/bat
				EOS
			end

			arch_only = missing & %w[expac pkgfile]

			unless arch_only.empty?
				message << <<~EOS
					#{arch_only.join(' and ')} are Arch specific, so aliases using them will not work on Debian.
				EOS
			end
		else
			message << <<~EOS
				This configuration expects several CachyOS utilities, including
				fastfetch, bat, eza, expac, fzf, and tealdeer.
			EOS
		end

		message.join("\n")
	end

	test do
		assert_path_exists prefix/'cachyos-config.fish'
		assert_path_exists prefix/'done.fish'
		assert_match opt_prefix.to_s, (prefix/'cachyos-config.fish').read
		assert_match '__done_version', (prefix/'done.fish').read
	end
end