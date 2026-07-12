class CompleteAlias < Formula
	desc 'automagical shell alias completion'
	homepage 'https://github.com/cykerway/complete-alias'
	url 'https://github.com/cykerway/complete-alias/archive/refs/tags/1.18.0.tar.gz'
	sha256 'c34b85c2729650415d97280afeeed6aa29a9e318a8a39061722493cacb927445'
	license 'GPL-3.0-or-later'
	head 'https://github.com/cykerway/complete-alias.git', branch: 'master'

	livecheck do
		url 'https://github.com/cykerway/complete-alias.git'
		regex(/^v?(\d+(?:\.\d+)+)$/i)
		strategy :git
	end

	depends_on 'bash-completion@2'

	def install
		pkgshare.install 'complete_alias'
	end

	def caveats
		<<~EOS
			Source complete-alias in ~/.bash_completion:

			  source #{opt_pkgshare}/complete_alias

			Then enable completion for specific aliases:

			  complete -F _complete_alias foo

			Or enable it for every currently defined alias:

			  complete -F _complete_alias "${!BASH_ALIASES[@]}"
		EOS
	end

	test do
		assert_match '_complete_alias', shell_output("bash -c 'source #{pkgshare}/complete_alias && declare -F _complete_alias'")
	end
end