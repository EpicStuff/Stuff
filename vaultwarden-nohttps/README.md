# vaultwarden-nohttps

Makes the bundled **web vault** load over plain `http://` (for a self-hosted
Vaultwarden reached via an SSH tunnel to `127.0.0.1`) by stripping the
HTTPS / secure-context guard the web-vault added in a recent update.

This is a **thin image layer** over the official `vaultwarden/server` image —
no repo clone, no compiling Vaultwarden. `docker build` just pulls the image
you already run and applies one text substitution.

> Why this is enough (and why a MITM proxy isn't needed): over an SSH tunnel
> the origin is `127.0.0.1`, which browsers treat as a *secure context*, so
> `crypto.subtle` is available and the vault can actually decrypt. The only
> thing blocking you is a client-side JS guard — that's all this removes.

## Files

| file | role |
|------|------|
| `Dockerfile`          | `FROM vaultwarden/server` + runs the patch |
| `patch-web-vault.sh`  | applies the patch, **fails the build** if the guard isn't found/removed |
| `detect.txt`          | regexes that detect the guard (used for the fail-loud check) |
| `patch.sed`           | substitutions that neutralize the guard |
| `patch-html.sed`      | strips `integrity=` (SRI) so edited bundles aren't rejected |
| `find-guard.sh`       | host tool: dumps the guard for me to refine patterns if a future update breaks it |

## Prerequisites

- Docker + `docker compose`.
- You know your Vaultwarden **service name** and **image tag** from your compose file.

## Quick start

### 1. Sanity-check the build (proves the guard was found & removed)

From inside this folder:

```sh
docker build --build-arg BASE=vaultwarden/server:latest -t vaultwarden-nohttps .
```

- Ends with `patch: done — guard removed…` → success.
- Ends with `patch: no known HTTPS guard found…` → the build's guard changed
  shape. See **Troubleshooting**.

Match `BASE` to whatever tag you actually run.

### 2. Wire it into your compose

In your `docker-compose.yml`, on the Vaultwarden service, **replace**:

```yaml
    image: vaultwarden/server:latest
```

**with** a build that still tags the same image:

```yaml
    image: vaultwarden/server:latest      # keep, so it's tagged normally
    build:
      context: /root/stuff/vaultwarden-nohttps   # adjust to where this folder lives
      args:
        BASE: vaultwarden/server:latest
```

Then:

```sh
docker compose up -d --build
```

Hard-reload the web vault in your browser (cached old bundles will mask the
change — disable cache in devtools or use a fresh profile).

## Updating Vaultwarden later

```sh
docker compose build --pull    # pulls the new base, re-applies the patch on top
docker compose up -d
```

If the guard's code shape is unchanged, it just works. If Bitwarden reshaped
it, `build` **fails loudly** (never ships an un-patched vault) — see below.

## Troubleshooting

**Build fails with `no known HTTPS guard found`** — the patterns are stale for
your build. Dump the real guard and send it to me to refresh `detect.txt` /
`patch.sed`:

```sh
./find-guard.sh YOUR_CONTAINER_NAME        # or a path to an extracted /web-vault
```

**Vault loads but still won't unlock** — you're probably not on a loopback
origin. Confirm the browser address bar shows `http://127.0.0.1:PORT` or
`http://localhost:PORT` (not a custom hostname — those are *not* secure
contexts, and no patch fixes that; the tunnel must terminate at loopback).

**Change doesn't appear** — stale browser cache. Hard-reload / clear the site's
cache / try a private window.

## How the patch is targeted

The guard is a URL-scheme check in the web-vault bundle. Every blocked path
(API `fetch`, the SignalR `connect$`, the notifications hub) is the same shape:

```js
if (!url.startsWith("https://") && !platformUtilsService.isDev()) throw new <Err>;
```

throwing `Insecure URL not allowed. All URLs must use HTTPS.`. The patch is a
single substitution that loosens the required prefix from `"https://"` to
`"http"`:

```
.startsWith("https://")  →  .startsWith("http")
```

so an `http://` URL satisfies the check and nothing throws. The same rewrite
also hits the settings URL-field validator (so you can *enter* an `http://`
server URL) and a URL-normalizer that already special-cased `http://` — both
harmless. `.startsWith("https://")` is a plain string+method literal, not a
minified name, so it's stable across builds.

This targets the guard by its stable structure, not a per-build minified
variable name. The fail-loud checks are the safety net: if a future web-vault
reshapes the check so the pattern no longer matches, the build errors out
instead of silently shipping a locked-out vault.
