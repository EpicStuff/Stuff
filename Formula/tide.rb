class Tide < Formula
	desc 'Ultimate Fish prompt'
	homepage 'https://github.com/IlanCosman/tide'
	url 'https://github.com/IlanCosman/tide.git', tag: 'v6.2.0', revision: 'c4e3831dc4392979478d3d7b66a68f0274996c85'
	license 'MIT'
	head 'https://github.com/IlanCosman/tide.git', branch: 'main'

	livecheck do
		url 'https://github.com/IlanCosman/tide.git'
		regex(/^v?(\d+(?:\.\d+)+)$/i)
		strategy :git
	end

	depends_on 'epic/stuff/fish-loader'

	def install
		(share/'fish/vendor_completions.d').install Dir['completions/*']
		(share/'fish/vendor_conf.d').install Dir['conf.d/*']
		(share/'fish/vendor_functions.d').install Dir['functions/*']
	end

	test do
		fish_share = share/'fish'

		assert_path_exists fish_share/'vendor_completions.d/tide.fish'
		assert_path_exists fish_share/'vendor_conf.d/_tide_init.fish'
		assert_path_exists fish_share/'vendor_functions.d/tide.fish'
		assert_path_exists fish_share/'vendor_functions.d/tide'
		assert_match "tide, version #{version}", (fish_share/'vendor_functions.d/tide.fish').read
	end
end