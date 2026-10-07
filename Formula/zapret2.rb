class Zapret2 < Formula
	desc 'Anti DPI software for circumventing deep packet inspection'
	homepage 'https://github.com/bol-van/zapret2'
	url 'https://github.com/bol-van/zapret2/releases/download/v1.0.5.2/zapret2-v1.0.5.2.tar.gz'
	sha256 'fb3bcf69e7d86b9fa2d60bd53c956ac06d9dcc3adf9392afd84865f1d94b1158'

	depends_on :linux
	depends_on arch: :x86_64

	livecheck do
		url :stable
		strategy :github_latest
	end

	def install
		(etc/'zapret2').install 'config.default' => 'config'

		libexec.install Dir['*']

		(libexec/'config').make_symlink etc/'zapret2/config'

		(libexec/'nfq2').install_symlink libexec/'binaries/linux-x86_64/nfqws2'
		(libexec/'ip2net').install_symlink libexec/'binaries/linux-x86_64/ip2net'
		(libexec/'mdig').install_symlink libexec/'binaries/linux-x86_64/mdig'

		bin.install_symlink libexec/'nfq2/nfqws2'
		bin.install_symlink libexec/'ip2net/ip2net'
		bin.install_symlink libexec/'mdig/mdig'

		service_file = libexec/'init.d/systemd/zapret2.service'
		inreplace service_file, '/opt/zapret2', opt_libexec.to_s
		(prefix/'zapret2.service').write service_file.read
	end

	service do
		name linux: 'zapret2'
		require_root true
	end

	test do
		assert_match version.to_s, shell_output("#{bin}/nfqws2 --version")
		assert_predicate etc/'zapret2/config', :exist?
		assert_predicate libexec/'config', :symlink?
		assert_predicate libexec/'nfq2/nfqws2', :symlink?
		assert_predicate prefix/'zapret2.service', :exist?

		service_file = (prefix/'zapret2.service').read
		assert_match opt_libexec.to_s, service_file
		refute_match '/opt/zapret2', service_file
	end
end