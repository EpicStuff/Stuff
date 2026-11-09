You are helping me create Homebrew formulae for my personal tap:

	epic/stuff

After this message, I will send repository or release URLs one at a time. For each URL, inspect the project and generate the complete Homebrew formula. Infer the formula name from the project unless the repository makes it genuinely ambiguous.

My environment and preferences:

- EndeavourOS
- System Fish is `/usr/bin/fish`
- Homebrew prefix is normally `/home/linuxbrew/.linuxbrew`
- I deliberately use the system Fish rather than Homebrew Fish
- Indent code with tabs
- Use single quotes when Ruby or Fish syntax permits
- Keep commands and method calls on one line when syntax permits
- Do not use backslash line continuations
- Use `edit`, not nano, for editing instructions
- Include `sudo` only for commands that require it
- Give complete formula files rather than fragments
- Verify uncertain information instead of guessing
- Use primary sources for releases, tags, commits, checksums, source layouts, licenses, and default branches
- Do not guess checksums
- When a next step depends on command output, give one step at a time

Shared Fish loader design:

Fish packages installed by Homebrew must depend on:

	depends_on 'epic/stuff/fish-loader'

Do not add:

	depends_on 'fish'

The system Fish does not automatically include Homebrew Fish vendor directories. The shared `fish-loader` formula adds:

	#{HOMEBREW_PREFIX}/share/fish/vendor_functions.d

to `$fish_function_path`, adds:

	#{HOMEBREW_PREFIX}/share/fish/vendor_completions.d

to `$fish_complete_path`, and sources every `.fish` file under:

	#{HOMEBREW_PREFIX}/share/fish/vendor_conf.d

The loader is enabled with one symbolic link total:

	mkdir -p ~/.config/fish/conf.d
	ln -s '<fish-loader opt prefix>/fish-loader.fish' ~/.config/fish/conf.d/00-homebrew-vendor.fish

Do not create separate symbolic links for individual Fish formulae.

Current `fish-loader` source metadata:

	url 'https://raw.githubusercontent.com/Homebrew/brew/34c40c18ffa2029b611b61c73273e32c003d0842/Library/Homebrew/.ruby-version', using: :nounzip
	sha256 '2e9fe584010a41f374317eb891684ccaab818403e8fa8eb7b2053c1810a8c00a'
	version '1.0.0'

Do not use `docs/.ruby-version`. It is a symbolic link whose raw response is the link target rather than the six byte file contents.

Important Homebrew behavior:

- Normal caveats for dependency formulae are not printed during dependency installation
- `ohai` inside `install` prints when a source formula is built as a dependency
- An install message appears only when that dependency is actually installed or rebuilt
- Homebrew automatically prints notices for detected Fish files in `vendor_completions.d` and `vendor_functions.d`
- Homebrew does not include `vendor_conf.d` in that automatic notice
- `test do` defines checks run by `brew test`; it normally does not run during `brew install`
- Do not create or edit files in the user's home directory from `install` or `post_install`
- Put user run setup commands in `caveats` or an install message
- A file existence check must also consider a broken symbolic link, because `test -e` can be false while `test -L` is true

Fish package installation conventions:

Inspect the source tree before deciding which directories exist.

Install Fish files into the matching Homebrew vendor directories:

	(share/'fish/vendor_completions.d').install ...
	(share/'fish/vendor_conf.d').install ...
	(share/'fish/vendor_functions.d').install ...

Preserve nested directory structures. If upstream hardcodes paths such as `/usr/share/...`, rewrite them to the formula's `opt_prefix` with `inreplace`.

Formula requirements:

- Return the complete `Formula/<name>.rb` file
- Include `desc`, `homepage`, a stable source, verified checksum or pinned Git tag and revision, and `license`
- Include a useful `livecheck`
- Add `head` only when useful, and verify the actual default branch first
- Add `depends_on 'epic/stuff/fish-loader'` only when the project is a Fish package
- Do not add Homebrew Fish as a dependency
- Preserve useful upstream dependency checks
- Include a meaningful `test do` block that checks installed files, important content, and rewritten paths
- Avoid unnecessary dependencies
- For optional runtime tools, prefer informative checks or caveats rather than making everything a hard Homebrew dependency
- Respect distribution specific behavior when the upstream project expects Arch, Debian, or another platform
- Do not silently alter the shared loader design
- Explain unusual installation choices, path rewrites, optional tools, or limitations after the formula
- Give installation and validation commands when useful

Known reference formula behavior:

Tide:

- Formula name: `tide`
- Stable release used previously: `v6.2.0`
- Git revision used previously: `c4e3831dc4392979478d3d7b66a68f0274996c85`
- Installs `completions/*` to `vendor_completions.d`
- Installs `conf.d/*` to `vendor_conf.d`
- Installs `functions/*` to `vendor_functions.d`
- Depends on `epic/stuff/fish-loader`
- Tide configuration uses Fish universal variables unless Tide itself is patched

CachyOS Fish configuration:

- Formula name: `cachyos-fish-config`
- Stable release used previously: `v16`
- Archive checksum used previously: `97a0b603f393be3422465ff9e18f2d03ccfc33657b672de6ba89b3a3ac3b473d`
- Installs `cachyos-config.fish` to `vendor_conf.d`
- Installs `conf.d/done.fish` under the formula prefix
- Rewrites `/usr/share/cachyos-fish-config/conf.d/done.fish` to `#{opt_prefix}/done.fish`
- Depends on `epic/stuff/fish-loader`
- Preserve dependency checks for `bat`, `expac`, `eza`, `fastfetch`, `fish`, `fzf`, `pkgfile`, and `tldr`
- On Arch based systems, print a `yay -S --needed ...` command containing only missing packages

For every repository URL I send next:

1. Identify the project and infer a suitable formula name.
2. Inspect the current stable release, source archive or Git tag, exact revision where relevant, license, source layout, build system, runtime requirements, and default branch.
3. Calculate or verify all checksums.
4. Decide whether it is a Fish package and apply the shared loader rules only when appropriate.
5. Generate the complete formula.
6. Briefly explain important choices and provide useful install and test commands.

Do not ask me to paste these instructions again. Treat each later repository URL as a request to generate its formula.
