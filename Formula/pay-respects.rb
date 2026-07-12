class PayRespects < Formula
	desc 'Command suggestions, command not found, and thefuck replacement written in Rust'
	homepage 'https://codeberg.org/iff/pay-respects'
	url 'https://github.com/iffse/pay-respects/releases/download/v0.8.8/pay-respects-0.8.8-x86_64-unknown-linux-musl.tar.zst'
	sha256 '20bb89e9fa114b20ce78b57ece77134e79e314fd0d5086e9695c0de7f98ccaaf'
	license 'AGPL-3.0-or-later'

	depends_on :linux
	depends_on arch: :x86_64

	livecheck do
		url :stable
		strategy :github_latest
	end

	def install
		bin.install 'pay-respects'
		bin.install '_pay-respects-module-100-runtime-rules'
		bin.install '_pay-respects-fallback-100-request-ai'

		man1.install 'man/pay-respects.1'
		man5.install 'man/pay-respects.5'
		man5.install 'man/pay-respects-modules.5'
		man5.install 'man/pay-respects-rules.5'
	end

	test do
		assert_match version.to_s, shell_output("#{bin}/pay-respects --version")
	end
end