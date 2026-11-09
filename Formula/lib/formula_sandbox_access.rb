require 'etc'
require 'fileutils'
require 'formula_installer'

module FormulaSandboxAccess
	def finish
		super
		link_loader(config_home/'fish/conf.d/homebrew-loader.fish', HOMEBREW_PREFIX/'opt/fish-loader/fish-loader.fish') if formula.name == 'fish-loader'
		return unless uses_xdg_data_loader?

		link_loader(config_home/'plasma-workspace/env/homebrew-xdg-data-dirs.sh', HOMEBREW_PREFIX/'opt/xdg-data-loader/xdg-data-dirs.sh')
		refresh_xdg_data(restart_dolphin: true)
	end

	def add_build_sandbox_rules(sandbox, formula_path, log_name:)
		super
		return unless log_name == 'build'

		allow_theia_extension_path(sandbox) if formula.name == 'theia-ide'
	end

	private

	def uses_xdg_data_loader?
		# Dependency names keep their tap prefix, e.g. epic/stuff/xdg-data-loader.
		formula.name == 'xdg-data-loader' || formula.deps.any? { |dependency| dependency.name.split('/').last == 'xdg-data-loader' }
	end

	def config_home
		# brew only passes XDG_CONFIG_HOME through as HOMEBREW_XDG_CONFIG_HOME, and HOME points into the build directory during installs.
		xdg_config_home = ENV['HOMEBREW_XDG_CONFIG_HOME'] || ENV['XDG_CONFIG_HOME']
		return Pathname(Etc.getpwuid(Process.uid).dir)/'.config' if xdg_config_home.to_s.empty?

		Pathname(xdg_config_home).expand_path
	end

	def link_loader(loader, target)
		if loader.symlink?
			return if loader.readlink == target

			opoo "Refusing to overwrite existing loader symlink: #{loader} -> #{loader.readlink}"
			return
		end
		if loader.exist?
			opoo "Refusing to overwrite existing loader path: #{loader}"
			return
		end

		FileUtils.mkdir_p(loader.dirname)
		File.symlink(target, loader)
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
end

FormulaInstaller.prepend(FormulaSandboxAccess) unless FormulaInstaller.ancestors.include?(FormulaSandboxAccess)
