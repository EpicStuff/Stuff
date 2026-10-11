class Blesh < Formula
	desc 'Bash line editor with syntax highlighting and autosuggestions'
	homepage 'https://github.com/akinomyoga/ble.sh'
	url 'https://github.com/akinomyoga/ble.sh/releases/download/v0.4.0-devel3/ble-0.4.0-devel3.tar.xz'
	version '0.4.0-devel3'
	sha256 'c8612ee612bc6b10dbfd6e85c6cbdfd7caf152a12d1f9de22ea0a9d735b3080c'
	license 'BSD-3-Clause'

	livecheck do
		url :stable
		regex(/^v?(\d+(?:\.\d+)+(?:-devel\d+)?)$/i)
		strategy :github_latest
	end

	def install
		prefix.install Dir['*']
	end

	def caveats
		<<~EOS
			Add this near the beginning of ~/.bashrc:
			  [[ $- == *i* ]] && source #{opt_prefix}/ble.sh --attach=none

			Add this near the end of ~/.bashrc:
			  [[ ${BLE_VERSION-} ]] && ble-attach
		EOS
	end

	test do
		assert_match version.to_s, shell_output("bash #{opt_prefix}/ble.sh --version")
	end
end