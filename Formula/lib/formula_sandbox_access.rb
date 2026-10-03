require 'formula_installer'

module FormulaSandboxAccess
	def add_build_sandbox_rules(sandbox, formula_path, log_name:)
		super
		return unless log_name == 'build'

		case formula.name
		when 'theia-ide'
			allow_theia_extension_path(sandbox)
		when 'fish-loader'
			allow_fish_loader_path(sandbox)
		when 'xdg-data-loader'
			allow_xdg_data_loader_path(sandbox)
		end
	end

	private

	def allow_theia_extension_path(sandbox)
		extensions_path = ENV['HOMEBREW_THEIA_EXTENSIONS']
		return if extensions_path.to_s.empty?

		path = Pathname(extensions_path).expand_path
		raise ArgumentError, "Native extension path does not exist: #{path}" unless path.directory?

		allow_build_path(sandbox, path.realpath)
	end

	def allow_fish_loader_path(sandbox)
		allow_build_path(sandbox, Pathname(Dir.home)/'.config/fish/conf.d')
	end

	def allow_xdg_data_loader_path(sandbox)
		config_home = ENV['XDG_CONFIG_HOME'].to_s.empty? ? Pathname(Dir.home)/'.config' : Pathname(ENV['XDG_CONFIG_HOME']).expand_path
		allow_build_path(sandbox, config_home/'plasma-workspace/env')
	end

	def allow_build_path(sandbox, path)
		sandbox.allow_read(path:, type: :subpath)
		sandbox.allow_write_path(path)
	end
end

FormulaInstaller.prepend(FormulaSandboxAccess) unless FormulaInstaller.ancestors.include?(FormulaSandboxAccess)
