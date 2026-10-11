require 'system_command'

module EnsureDeps
	DEFAULT_VERSION_PATTERN = /\d+(?:\.\d+)+/

	def ensure_build_dep(formula, command:, minimum_version: nil, version_below: nil, version_args: ['--version'], version_pattern: DEFAULT_VERSION_PATTERN)
		return if system_build_dep_satisfied?(command, minimum_version:, version_below:, version_args:, version_pattern:)

		depends_on formula => :build
	end

	private

	def system_build_dep_satisfied?(command, minimum_version:, version_below:, version_args:, version_pattern:)
		executable = Utils::Shell.which(command, ORIGINAL_PATHS)
		return false unless executable
		return true unless minimum_version || version_below

		result = SystemCommand.run(executable, args: version_args, print_stderr: false)
		return false unless result.success?

		version_string = result.merged_output[version_pattern]
		return false unless version_string

		version = Version.new(version_string)
		return false if minimum_version && version < Version.new(minimum_version)
		return false if version_below && version >= Version.new(version_below)

		true
	end
end
