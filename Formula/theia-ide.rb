require 'json'
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
		extensions = prepare_native_extensions

		if extensions.empty?
			system 'yarn', 'install', '--frozen-lockfile'
		else
			system 'yarn', 'install'
		end

		system 'yarn', 'build:extensions'
		extensions.each do |extension|
			next if extension[:built_by_default] || !extension[:has_build_script]

			system 'yarn', 'workspace', extension[:name], 'build'
		end

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

	private

	def prepare_native_extensions
		extensions_path = ENV['HOMEBREW_THEIA_EXTENSIONS']
		return [] if extensions_path.to_s.empty?

		root = Pathname(extensions_path).expand_path
		odie "Native extension path does not exist: #{root}" unless root.directory?

		extension_paths = if (root/'package.json').file?
			[root]
		else
			root.children.select { |path| path.directory? && (path/'package.json').file? }
		end
		odie "No native Theia extensions found in #{root}" if extension_paths.empty?

		electron_package_path = buildpath/'applications/electron/package.json'
		electron_package = JSON.parse(electron_package_path.read)
		dependencies = electron_package.fetch('dependencies')

		extensions = extension_paths.sort.map.with_index do |path, index|
			manifest = JSON.parse((path/'package.json').read)
			name = manifest['name']
			version = manifest['version']

			odie "Native extension is missing a package name: #{path}" if name.to_s.empty?
			odie "Native extension is missing a package version: #{path}" if version.to_s.empty?
			odie "Package is not a native Theia extension: #{path}" unless manifest['theiaExtensions']

			workspace_path = buildpath/'theia-extensions'/"local-#{index}-#{path.basename}"
			odie "Native extension workspace already exists: #{workspace_path}" if workspace_path.exist? || workspace_path.symlink?

			ln_s path.realpath, workspace_path
			dependencies[name] = version

			{
				name:,
				built_by_default: name.match?(/\Atheia-ide.*ext\z/),
				has_build_script: manifest.dig('scripts', 'build').to_s.length.positive?,
			}
		end

		electron_package_path.write(JSON.pretty_generate(electron_package) + "\n")
		extensions
	end
end
