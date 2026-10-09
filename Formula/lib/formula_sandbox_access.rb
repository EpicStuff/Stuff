require 'etc'
require 'fileutils'
require 'formula_installer'

module FormulaSandboxAccess
	def finish
		super
		return unless uses_xdg_data_loader?

		ensure_xdg_data_loader_link
		refresh_xdg_data(restart_dolphin: true)
	end

	def add_build_sandbox_rules(sandbox, formula_path, log_name:)
		super
		return unless log_name == 'build'

		case formula.name
		when 'theia-ide'
			allow_theia_extension_path(sandbox)
		when 'fish-loader'
			allow_fish_loader_path(sandbox)
		end
	end

	private

	def uses_xdg_data_loader?
		# Dependency names keep their tap prefix, e.g. epic/stuff/xdg-data-loader.
		formula.name == 'xdg-data-loader' || formula.deps.any? { |dependency| dependency.name.split('/').last == 'xdg-data-loader' }
	end

	def ensure_xdg_data_loader_link
		# brew only passes XDG_CONFIG_HOME through as HOMEBREW_XDG_CONFIG_HOME.
		xdg_config_home = ENV['HOMEBREW_XDG_CONFIG_HOME'] || ENV['XDG_CONFIG_HOME']
		config_home = if xdg_config_home.to_s.empty?
			Pathname(Etc.getpwuid(Process.uid).dir)/'.config'
		else
			Pathname(xdg_config_home).expand_path
		end
		config_dir = config_home/'plasma-workspace/env'
		loader = config_dir/'homebrew-xdg-data-dirs.sh'
		target = HOMEBREW_PREFIX/'opt/xdg-data-loader/xdg-data-dirs.sh'

		if loader.symlink?
			return false if loader.readlink == target

			opoo "Refusing to overwrite existing XDG data loader symlink: #{loader} -> #{loader.readlink}"
			return false
		end
		if loader.exist?
			opoo "Refusing to overwrite existing XDG data loader path: #{loader}"
			return false
		end

		FileUtils.mkdir_p(config_dir)
		File.symlink(target, loader)
		true
	end

	def refresh_xdg_data(restart_dolphin:)
		refresh = HOMEBREW_PREFIX/'opt/xdg-data-loader/bin/xdg-data-refresh'
		return unless refresh.executable?

		args = [refresh.to_s]
		args << '--restart-dolphin' if restart_dolphin
		success = system(*args)
		opoo 'Could not refresh the KDE application cache; continuing without an immediate desktop refresh' unless success
	end

	def allow_theia_extension_path(sandbox)
		extensions_path = ENV['HOMEBREW_THEIA_EXTENSIONS']
		return if extensions_path.to_s.empty?

		path = Pathname(extensions_path).expand_path
		raise ArgumentError, "Native extension path does not exist: #{path}" unless path.directory?

		# The build only copies the extension tree, so it never needs to write there.
		sandbox.allow_read(path: path.realpath, type: :subpath)
	end

	def allow_fish_loader_path(sandbox)
		allow_build_path(sandbox, Pathname(Dir.home)/'.config/fish/conf.d')
	end

	def allow_build_path(sandbox, path)
		sandbox.allow_read(path:, type: :subpath)
		sandbox.allow_write_path(path)
	end
end

FormulaInstaller.prepend(FormulaSandboxAccess) unless FormulaInstaller.ancestors.include?(FormulaSandboxAccess)
