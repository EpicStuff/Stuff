require_relative './lib/formula_sandbox_access'

class XdgDataLoader < Formula
	desc 'Expose Homebrew shared data to Plasma applications'
	homepage 'https://codeberg.org/EpicStuff/stuff'
	url 'https://raw.githubusercontent.com/Homebrew/brew/34c40c18ffa2029b611b61c73273e32c003d0842/Library/Homebrew/.ruby-version', using: :nounzip
	sha256 '2e9fe584010a41f374317eb891684ccaab818403e8fa8eb7b2053c1810a8c00a'
	license 'MIT'
	version '1.0.2'

	livecheck do
		skip 'No upstream'
	end

	def install
		(prefix/'xdg-data-dirs.sh').write <<~SH
			homebrew_share='#{HOMEBREW_PREFIX}/share'
			xdg_data_dirs="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

			case ":$xdg_data_dirs:" in
				*":$homebrew_share:"*) ;;
				*) XDG_DATA_DIRS="$homebrew_share:$xdg_data_dirs" ;;
			esac

			export XDG_DATA_DIRS
			unset homebrew_share xdg_data_dirs
		SH

		refresh = bin/'xdg-data-refresh'
		refresh.write <<~SH
			#!/bin/sh
			. '#{opt_prefix}/xdg-data-dirs.sh'

			homebrew_share='#{HOMEBREW_PREFIX}/share'
			restart_plasma=false
			status=0

			if command -v systemctl >/dev/null 2>&1; then
				systemd_xdg_data_dirs="$(systemctl --user show-environment 2>/dev/null | sed -n 's/^XDG_DATA_DIRS=//p')"
				case ":$systemd_xdg_data_dirs:" in
					*":$homebrew_share:"*) ;;
					*) restart_plasma=true ;;
				esac

				systemctl --user import-environment XDG_DATA_DIRS || status=1
			fi

			if command -v dbus-update-activation-environment >/dev/null 2>&1; then
				dbus-update-activation-environment --systemd XDG_DATA_DIRS || status=1
			fi

			if command -v kbuildsycoca6 >/dev/null 2>&1; then
				kbuildsycoca6 "$@" || status=1
			fi

			if [ "$restart_plasma" = true ] && command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet plasma-plasmashell.service; then
				systemctl --user restart plasma-plasmashell.service || status=1
			fi

			exit "$status"
		SH
		chmod 0755, refresh

		install_loader_link
	end

	def caveats
		config_home = ENV['XDG_CONFIG_HOME'].to_s.empty? ? '~/.config' : ENV['XDG_CONFIG_HOME']
		<<~EOS
			Make sure to remove #{config_home}/plasma-workspace/env/homebrew-xdg-data-dirs.sh before uninstalling xdg-data-loader.
		EOS
	end

	test do
		loader = prefix/'xdg-data-dirs.sh'

		assert_path_exists loader
		assert_match "#{HOMEBREW_PREFIX}/share", loader.read
		assert_match 'XDG_DATA_DIRS', loader.read
		assert_match '/usr/local/share:/usr/share', loader.read

		refresh = bin/'xdg-data-refresh'
		assert_predicate refresh, :executable?
		assert_match 'kbuildsycoca6', refresh.read
		assert_match 'import-environment XDG_DATA_DIRS', refresh.read
		assert_match 'plasma-plasmashell.service', refresh.read
	end

	private

	def install_loader_link
		config_home = ENV['XDG_CONFIG_HOME'].to_s.empty? ? Pathname(Dir.home)/'.config' : Pathname(ENV['XDG_CONFIG_HOME']).expand_path
		config_dir = config_home/'plasma-workspace/env'
		loader = config_dir/'homebrew-xdg-data-dirs.sh'
		target = opt_prefix/'xdg-data-dirs.sh'

		config_dir.mkpath

		if loader.symlink?
			return if loader.readlink == target

			odie "Refusing to overwrite existing symlink: #{loader} -> #{loader.readlink}"
		end
		odie "Refusing to overwrite existing path: #{loader}" if loader.exist?

		ln_s target, loader
	end
end
