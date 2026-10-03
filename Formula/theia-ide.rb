require_relative '../lib/ensure_deps'

class TheiaIde < Formula
	extend EnsureDeps

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
	ensure_build_dep 'node@24', command: 'node', minimum_version: '24'
	ensure_build_dep 'yarn', command: 'yarn', minimum_version: '1.7', version_below: '2'
	ensure_build_dep 'python@3.14', command: 'python3'
	ensure_build_dep 'make', command: 'make'
	ensure_build_dep 'pkgconf', command: 'pkg-config'

	allow_network_access! :build
	env :std

	def install
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
