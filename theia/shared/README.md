# Shared build helpers

`theia-source-check.mjs` is a build helper, not an extension. Extensions that patch or depend on specific upstream Theia code pin those snippets and fail their build when Theia changes them, so an upgrade has to be re-verified first.

Extensions import it by the relative path `../../shared/`, which still resolves in the Homebrew build because the formula copies each folder as is.
