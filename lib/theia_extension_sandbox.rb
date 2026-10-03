require 'formula_installer'

module TheiaExtensionSandbox
	def add_build_sandbox_rules(sandbox, formula_path, log_name:)
		super
		return unless formula.name == 'theia-ide'
		return unless log_name == 'build'

		extensions_path = ENV['HOMEBREW_THEIA_EXTENSIONS']
		return if extensions_path.to_s.empty?

		path = Pathname(extensions_path).expand_path
		raise ArgumentError, "Native extension path does not exist: #{path}" unless path.directory?

		path = path.realpath
		sandbox.allow_read(path:, type: :subpath)
		sandbox.allow_write_path(path)
	end
end

FormulaInstaller.prepend(TheiaExtensionSandbox) unless FormulaInstaller.ancestors.include?(TheiaExtensionSandbox)
