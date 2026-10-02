class TheiaIde < Formula
	desc 'Cloud and desktop IDE based on the Eclipse Theia platform'
	homepage 'https://theia-ide.org/'
	url 'https://github.com/eclipse-theia/theia-ide.git',
		tag: 'v1.75.0',
		revision: '9145abe093659217ef2967cc2955abdc37c16408'
	license 'MIT'

	livecheck do
		url :stable
		regex(/^v?(\d+(?:\.\d+){2})$/i)
		strategy :git
	end

	depends_on :linux

	allow_network_access! :build
	env :std

	def install
		required_commands = %w[node yarn python3 make pkg-config]
		missing_commands = required_commands.reject { |command| which(command) }
		odie "Missing build tools: #{missing_commands.join(', ')}" if missing_commands.any?

		node_version = Version.new(shell_output('node --version').strip.delete_prefix('v'))
		odie 'Node.js 24 or newer is required' if node_version < Version.new('24')

		yarn_version = Version.new(shell_output('yarn --version').strip)
		odie 'Yarn 1.7 or newer from the 1.x series is required' if yarn_version < Version.new('1.7') || yarn_version >= Version.new('2')

		system 'yarn', 'install', '--frozen-lockfile'
		system 'yarn', 'build:extensions'
		system 'yarn', 'electron', 'build:prod'
		system 'yarn', 'download:plugins'
		system 'yarn', 'electron', 'package:preview'

		app_dir = buildpath.glob('applications/electron/dist/linux*-unpacked').find(&:directory?)
		odie 'Could not find the packaged Theia IDE application' unless app_dir

		launcher = app_dir/'theia-ide-electron-app'
		odie 'Could not find the packaged Theia IDE launcher' unless launcher.executable?

		libexec.install app_dir.children
		bin.install_symlink libexec/'theia-ide-electron-app' => 'theia'
	end

	test do
		assert_match version.to_s, shell_output("#{bin}/theia --version")
		assert_predicate libexec/'theia-ide-electron-app.bin', :executable?
	end
end
