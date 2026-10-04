require 'digest'
require 'json'
require_relative './lib/ensure_deps'
require_relative './lib/formula_sandbox_access'

class TheiaIde < Formula
	extend EnsureDeps

	desc 'Cloud and desktop IDE based on the Eclipse Theia platform'
	homepage 'https://theia-ide.org/'
	url 'https://github.com/eclipse-theia/theia-ide.git',
		tag: 'v1.75.0',
		revision: '9145abe093659217ef2967cc2955abdc37c16408'
	revision 14

	livecheck do
		url :stable
		regex(/^v?(\d+(?:\.\d+){2})$/i)
		strategy :git
	end

	depends_on :linux
	depends_on 'epic/stuff/xdg-data-loader'
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
		cache_root = HOMEBREW_CACHE/'npm_cache/theia-ide'
		ENV['XDG_CACHE_HOME'] = cache_root.to_s
		prepare_ffmpeg_cache(cache_root)
		system_electron = prepare_build_manifests
		build_jobs = [ENV.make_jobs.to_i, 1].max
		child_jobs = [Math.sqrt(build_jobs).floor, 1].max
		ENV['CHILD_CONCURRENCY'] = child_jobs.to_s
		ENV['JOBS'] = [(build_jobs.to_f/child_jobs).ceil, 1].max.to_s
		extensions = prepare_native_extensions
		integrate_vscode_cli_usage if extensions.any? { |extension| extension[:name] == 'theia-keep-warm' }

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
		plugin_cache = plugin_cache_path(cache_root)
		restore_plugin_cache(plugin_cache)
		system 'yarn', 'download:plugins'
		store_plugin_cache(plugin_cache)
		install_local_vscode_extensions
		system 'yarn', 'electron', 'package:preview'

		app_dir = buildpath.glob('applications/electron/dist/linux*-unpacked').find(&:directory?)
		odie 'Could not find the packaged Theia IDE application' unless app_dir

		launcher = app_dir/'theia-ide-electron-app'
		odie 'Could not find the packaged Theia IDE launcher' unless launcher.executable?

		libexec.install app_dir.children
		bin.write_exec_script libexec/'theia-ide-electron-app'
		mv bin/'theia-ide-electron-app', bin/'theia'
		install_desktop_entry
	end

	test do
		assert_match version.to_s, shell_output("#{bin}/theia --version")
		assert_predicate libexec/'theia-ide-electron-app.bin', :executable?
	end

	private

	def install_desktop_entry
		desktop_dir = buildpath/'desktop-entry'
		desktop_dir.mkpath
		script = buildpath/'generate-desktop-entry.cjs'
		script.write <<~JS
			const fs = require('fs/promises');
			const os = require('os');
			const path = require('path');
			const { build } = require('electron-builder');

			async function main() {
				const projectDir = process.argv[2];
				const outputDir = process.argv[3];
				const prepackaged = await fs.mkdtemp(path.join(os.tmpdir(), 'theia-desktop-'));

				try {
					await fs.mkdir(path.join(prepackaged, 'resources'), { recursive: true });
					let generated = false;

					await build({
						projectDir,
						linux: ['deb'],
						prepackaged,
						publish: 'never',
						config: {
							afterPack: null
						},
						effectiveOptionComputed: async value => {
							const [args, desktopFilePath] = value;
							const mapping = args.find(arg => typeof arg === 'string' && arg.includes('=/usr/share/applications/'));
							const match = mapping?.match(/=\\/usr\\/share\\/applications\\/([^/]+\\.desktop)$/);
							if (!match || typeof desktopFilePath !== 'string') {
								throw new Error('Electron Builder did not expose the generated desktop entry');
							}

							await fs.copyFile(desktopFilePath, path.join(outputDir, match[1]));
							generated = true;
							return true;
						}
					});

					if (!generated) {
						throw new Error('Electron Builder did not generate a desktop entry');
					}
				} finally {
					await fs.rm(prepackaged, { recursive: true, force: true });
				}
			}

			main().catch(error => {
				console.error(error);
				process.exitCode = 1;
			});
		JS

		begin
			system 'node', script, buildpath/'applications/electron', desktop_dir
			desktop_files = desktop_dir.glob('*.desktop')
			raise 'Electron Builder generated an unexpected number of desktop entries' unless desktop_files.length == 1

			desktop_file = desktop_files.first
			contents = desktop_file.read
			exec_lines = contents.lines.count { |line| line.start_with?('Exec=') }
			raise 'Generated desktop entry does not contain exactly one Exec entry' unless exec_lines == 1

			exec_path = (opt_bin/'theia').to_s
			exec_path = %("#{exec_path.gsub('\\', '\\\\').gsub('"', '\\"')}") unless exec_path.match?(/\A[\/0-9A-Za-z._-]+\z/)
			contents = contents.sub(/^Exec=(?:"(?:[^"\\]|\\.)*"|\S+)(.*)$/, "Exec=#{exec_path}\\1")

			icon_lines = contents.lines.count { |line| line.start_with?('Icon=') }
			raise 'Generated desktop entry does not contain exactly one Icon entry' unless icon_lines == 1
			icon_name = contents[/^Icon=(.+)$/, 1]&.strip
			raise 'Generated desktop entry contains an invalid Icon entry' unless icon_name&.match?(/\A[A-Za-z0-9._-]+\z/)

			icon_source = buildpath/'applications/electron/resources/icons/LinuxLauncherIcons/512x512.png'
			raise 'Could not find the Theia launcher icon' unless icon_source.file?

			icon_file = "#{icon_name}.png"
			icon_path = opt_share/'icons'/icon_file
			contents = contents.sub(/^Icon=.*$/, "Icon=#{icon_path}")
			desktop_file.atomic_write(contents)

			(share/'icons').install icon_source => icon_file
			(share/'applications').install desktop_file
		rescue StandardError => e
			opoo "Could not generate Theia desktop entry with Electron Builder; continuing without desktop integration: #{e.message}"
		end
	end

	def install_local_vscode_extensions
		extensions_path = ENV['HOMEBREW_THEIA_EXTENSIONS']
		return if extensions_path.to_s.empty?

		root = Pathname(extensions_path).expand_path/'vscode-extensions'
		return unless root.directory?

		plugin_dir = buildpath/'plugins'
		plugin_dir.mkpath
		extension_paths = root.children.select { |path| path.directory? && (path/'package.json').file? }.sort

		extension_paths.each do |path|
			manifest = JSON.parse((path/'package.json').read)
			name = manifest['name']
			publisher = manifest['publisher']

			odie "VS Code extension is missing a package name: #{path}" if name.to_s.empty?
			odie "VS Code extension is missing a publisher: #{path}" if publisher.to_s.empty?

			destination = plugin_dir/"local-#{publisher}.#{name}"
			odie "VS Code extension destination already exists: #{destination}" if destination.exist?

			cp_r path.realpath, destination
		end
	end

	def prepare_ffmpeg_cache(cache_root)
		cache = cache_root/'theia-cli-cache'
		cache.mkpath
		tmp_root = Pathname(ENV.fetch('TMPDIR'))/'theia-cli'
		tmp_root.mkpath
		link = tmp_root/'cache'
		rm_rf link if link.exist? || link.symlink?
		ln_s cache, link
	end

	def plugin_cache_path(cache_root)
		package = JSON.parse((buildpath/'package.json').read)
		fingerprint = Digest::SHA256.hexdigest(JSON.generate({
			plugins: package['theiaPlugins'],
			excluded: package['theiaPluginsExcludeIds'],
		}))
		cache_root/'plugins'/version.to_s/fingerprint
	end

	def restore_plugin_cache(cache)
		return unless cache.directory?

		plugins = buildpath/'plugins'
		plugins.mkpath
		system 'cp', '-a', '--reflink=auto', "#{cache}/.", plugins
	end

	def store_plugin_cache(cache)
		plugins = buildpath/'plugins'
		return unless plugins.directory?

		rm_rf cache
		cache.mkpath
		system 'cp', '-a', '--reflink=auto', "#{plugins}/.", cache
	end

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
		electron_package.fetch('dependencies').delete('@theia/test')
		disable_ai_extensions(electron_package) if ENV['HOMEBREW_THEIA_NO_AI'] == '1'

		system_electron = find_system_electron(electron_package.dig('devDependencies', 'electron'))
		if system_electron
			electron_package['devDependencies']['electron'] = system_electron[:version]
			patch_electron_builder(system_electron)
		end
		electron_package_path.atomic_write(JSON.pretty_generate(electron_package) + "\n")
		system_electron
	end

	def disable_ai_extensions(electron_package)
		electron_package.fetch('dependencies').delete_if { |name, _version| name.start_with?('@theia/ai-') }

		product_package_path = buildpath/'theia-extensions/product/package.json'
		product_package = JSON.parse(product_package_path.read)
		product_package.fetch('dependencies').delete_if { |name, _version| name.start_with?('@theia/ai-') }
		product_package_path.atomic_write(JSON.pretty_generate(product_package) + "\n")

		frontend_module_path = buildpath/'theia-extensions/product/src/browser/theia-ide-frontend-module.ts'
		frontend_module = frontend_module_path.read
		frontend_module.sub!("import { AIRegistryConfiguration } from '@theia/ai-registry/lib/common/ai-registry-configuration';\n", '')
		frontend_module.sub!("import { TheiaIDEAIRegistryConfiguration } from './theia-ide-ai-registry-configuration';\n", '')

		ai_binding = [
			'    if (isBound(AIRegistryConfiguration)) {',
			'        rebind(AIRegistryConfiguration).to(TheiaIDEAIRegistryConfiguration).inSingletonScope();',
			'    } else {',
			'        bind(AIRegistryConfiguration).to(TheiaIDEAIRegistryConfiguration).inSingletonScope();',
			'    }',
		].join("\n") + "\n"
		odie 'Could not remove Theia IDE AI registry binding' unless frontend_module.include?(ai_binding)

		frontend_module.sub!(ai_binding, '')
		frontend_module_path.atomic_write(frontend_module)
		rm_f buildpath/'theia-extensions/product/src/browser/theia-ide-ai-registry-configuration.ts'
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

	def integrate_vscode_cli_usage
		usage_path = buildpath/'applications/electron/scripts/cli-usage.js'
		source = usage_path.read
		old_help_condition = "if (hasFlag(['--help'])) {"
		new_help_condition = "if (hasFlag(['--help', '-h'])) {"
		old_help_line = '  --help                              Print usage'
		new_help_block = <<~HELP.chomp
			  -h, --help                          Print usage
			  -n, --new-window                    Force a new window
			  -r, --reuse-window                  Force the last active window to be reused
			  -g, --goto <file:line[:column]>     Open a file at the given line and column
			  -d, --diff <file1> <file2>          Compare two files
			      --list-extensions               List installed user extensions
			      --show-versions                 Show versions with --list-extensions
			      --install-extension <id|vsix>   Install or update an extension
			      --uninstall-extension <id>      Uninstall an extension
			      --user-data-dir <dir>           Set Electron and Theia user data directories
			      --disable-gpu                   Disable hardware acceleration
			      --keep-warm                     Keep the Electron main process and backend resident
			      --keep-warmer                   Also preload a hidden empty frontend renderer
			      --daemon                        Detach the requested invocation
			      --quit                          Stop the resident keep warm instance
		HELP

		already_patched = source.include?(new_help_condition) && source.include?('  -n, --new-window')
		return if already_patched

		odie 'Theia CLI usage is only partially patched' if source.include?(new_help_condition) || source.include?('  -n, --new-window')
		odie 'Unsupported Theia CLI help condition' unless source.include?(old_help_condition)
		odie 'Unsupported Theia CLI help layout' unless source.include?(old_help_line)

		source = source.sub(old_help_condition, new_help_condition)
		source = source.sub(old_help_line, new_help_block)
		usage_path.atomic_write(source)
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
