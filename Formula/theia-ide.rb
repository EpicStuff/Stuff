require 'json'
require_relative '../lib/ensure_deps'
require_relative '../lib/formula_sandbox_access'

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
		ENV.prepend_path 'PKG_CONFIG_PATH', '/usr/share/pkgconfig'
		ENV['PUPPETEER_SKIP_DOWNLOAD'] = 'true'
		ENV['XDG_CACHE_HOME'] = (HOMEBREW_CACHE/'theia-ide').to_s
		system_electron = prepare_build_manifests
		build_jobs = [ENV.make_jobs.to_i, 1].max
		child_jobs = [Math.sqrt(build_jobs).floor, 1].max
		ENV['CHILD_CONCURRENCY'] = child_jobs.to_s
		ENV['JOBS'] = [(build_jobs.to_f/child_jobs).ceil, 1].max.to_s
		extensions = prepare_native_extensions

		if extensions.empty?
			system 'yarn', 'install', '--frozen-lockfile'
		else
			system 'yarn', 'install'
		end
		copy_system_electron(system_electron) if system_electron

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
		bin.write_exec_script libexec/'theia-ide-electron-app'
		mv bin/'theia-ide-electron-app', bin/'theia'
	end

	test do
		assert_match version.to_s, shell_output("#{bin}/theia --version")
		assert_predicate libexec/'theia-ide-electron-app.bin', :executable?
	end

	private

	def prepare_build_manifests
		root_package_path = buildpath/'package.json'
		root_package = JSON.parse(root_package_path.read)
		root_package['workspaces'] = ['applications/electron', 'theia-extensions/*']

		plugins = root_package.fetch('theiaPlugins')
		plugins.delete('vscjava.vscode-java-pack')
		plugins.delete('vscjava.vscode-java-dependency')

		excluded = root_package.fetch('theiaPluginsExcludeIds')
		excluded.concat([
			'redhat.java',
			'vscjava.vscode-gradle',
			'vscjava.vscode-java-debug',
			'vscjava.vscode-java-dependency',
			'vscjava.vscode-java-test',
			'vscjava.vscode-maven',
			'vscode.theme-abyss',
			'vscode.theme-kimbie-dark',
			'vscode.theme-monokai',
			'vscode.theme-monokai-dimmed',
			'vscode.theme-quietlight',
			'vscode.theme-red',
			'vscode.theme-solarized-dark',
			'vscode.theme-solarized-light',
			'vscode.theme-tomorrow-night-blue',
			'vscode.vscode-theme-seti',
		])
		root_package['theiaPluginsExcludeIds'] = excluded.uniq

		lint_dependencies = %w[
			@eclipse-dash/nodejs-wrapper
			@typescript-eslint/eslint-plugin
			@typescript-eslint/eslint-plugin-tslint
			@typescript-eslint/parser
			eslint
			eslint-plugin-deprecation
			eslint-plugin-import
			eslint-plugin-no-null
			eslint-plugin-no-unsanitized
			eslint-plugin-react
		]
		lint_dependencies.each { |dependency| root_package.fetch('devDependencies').delete(dependency) }
		root_package_path.atomic_write(JSON.pretty_generate(root_package) + "\n")

		electron_package_path = buildpath/'applications/electron/package.json'
		electron_package = JSON.parse(electron_package_path.read)
		test_dependencies = %w[
			@wdio/cli
			@wdio/local-runner
			@wdio/mocha-framework
			@wdio/spec-reporter
			chai
			electron-chromedriver
			electron-mocha
			mocha
			wdio-chromedriver-service
			webdriverio
		]
		test_dependencies.each { |dependency| electron_package.fetch('devDependencies').delete(dependency) }

		system_electron = find_system_electron(electron_package.dig('devDependencies', 'electron'))
		if system_electron
			electron_package['devDependencies']['electron'] = system_electron[:version]
			patch_electron_builder(system_electron)
		end
		electron_package_path.atomic_write(JSON.pretty_generate(electron_package) + "\n")
		system_electron
	end

	def find_system_electron(required_version)
		major = required_version.to_s[/\d+/]
		return unless major

		Pathname('/usr/lib').glob('electron*/version').filter_map do |version_file|
			version = version_file.read.strip
			dist = version_file.dirname
			next unless version.start_with?("#{major}.") && (dist/'electron').executable?

			{ version:, dist: }
		end.max_by { |electron| Version.new(electron[:version]) }
	end

	def patch_electron_builder(system_electron)
		config_path = buildpath/'applications/electron/electron-builder.yml'
		config = config_path.read
		config = config.sub(/^electronVersion:.*$/, "electronVersion: #{system_electron[:version]}")
		config_path.atomic_write(config)
	end

	def copy_system_electron(system_electron)
		dist = buildpath/'node_modules/electron/dist'
		rm_rf dist if dist.exist? || dist.symlink?
		mkdir_p dist
		system 'cp', '-a', '--reflink=auto', "#{system_electron[:dist]}/.", dist
	end

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

			cp_r path.realpath, workspace_path
			dependencies[name] = version

			{
				name:,
				built_by_default: name.match?(/\Atheia-ide.*ext\z/),
				has_build_script: manifest.dig('scripts', 'build').to_s.length.positive?,
			}
		end

		electron_package_path.atomic_write(JSON.pretty_generate(electron_package) + "\n")
		integrate_webview_context_fix if extensions.any? { |extension| extension[:name] == 'theia-webview-context-fix' }
		extensions
	end

	def integrate_webview_context_fix
		esbuild_path = buildpath/'applications/electron/esbuild.mjs'
		source = esbuild_path.read
		import_line = "import { webviewContextFixPlugin } from 'theia-webview-context-fix/esbuild';"
		plugin_line = 'browserOptions.plugins.push(webviewContextFixPlugin());'

		return if source.include?(import_line) && source.include?(plugin_line)
		odie 'Theia webview context fix is only partially integrated' if source.include?(import_line) || source.include?(plugin_line)

		import_anchor = "import esbuild from 'esbuild';"
		plugin_anchor = 'nodeOptions.plugins.unshift(asarRipgrepPlugin);'
		odie 'Unsupported Theia esbuild layout for webview context fix' unless source.include?(import_anchor) && source.include?(plugin_anchor)

		source = source.sub(import_anchor, "#{import_anchor}\n#{import_line}")
		source = source.sub(plugin_anchor, "#{plugin_anchor}\n#{plugin_line}")
		esbuild_path.atomic_write(source)
	end
end
