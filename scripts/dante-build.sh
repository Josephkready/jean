#!/usr/bin/env bash
#
# Fail-closed production build for the dante host deploy (see the `jean` service
# entry in Josephkready/dante-config `ansible/host_vars/localhost.yml`).
#
# Why this script exists:
#   dante-sync (ansible-pull) resets ~/prod/jean to origin/main, runs this as
#   `build_command` when the SHA moves, then restarts jean.service.
#   - Frontend (`dist/`) is built into a staging directory first (`$STAGE/dist`)
#     and only swapped into `$ROOT/dist` after verification, so a failed build
#     leaves the previous working frontend untouched.
#   - `dist/.gitkeep` is preserved inside `$ROOT/dist` so the git working tree
#     remains clean after the swap.
#   - `bin/jean-server` is cached by the tree hash of `jean-core/` + `src-server/`.
#     When those directories match an upstream release tag (`v<version>`), the
#     official `jean-server-linux-amd64-<version>.tar.gz` release asset is verified
#     against its `.sha256` and extracted; whenever `jean-core/` or `src-server/`
#     carries fork modifications (or `JEAN_FORCE_CARGO_BUILD=1`), `cargo build --release`
#     compiles `src-server` from source.

set -euo pipefail

export PATH="/home/jkready/.bun/bin:/home/jkready/.cargo/bin:/home/jkready/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAGE="$ROOT/.dante-build"
BACKUP="$ROOT/.dante-build-prev"
LOCK="$ROOT/.dante-build.lock"

log() { printf '[dante-build] %s\n' "$*"; }
die() { printf '[dante-build] ERROR: %s\n' "$*" >&2; exit 1; }

compute_rust_hash() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    {
      git rev-parse HEAD:jean-core HEAD:src-server 2>/dev/null || true
      git status --porcelain -- jean-core src-server 2>/dev/null || true
    } | sha256sum | awk '{print $1}'
  else
    find jean-core src-server -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
  fi
}

rust_matches_upstream_tag() {
  local tag="$1"
  git rev-parse --verify --quiet "refs/tags/${tag}^{commit}" >/dev/null 2>&1 || return 1
  git diff --quiet "${tag}" HEAD -- jean-core src-server 2>/dev/null || return 1
  test -z "$(git status --porcelain -- jean-core src-server 2>/dev/null)"
}

download_prebuilt_server() {
  local version="$1"
  local out_bin="$2"
  local repo="${JEAN_UPSTREAM_REPO:-coollabsio/jean}"
  local tarball_name="jean-server-linux-amd64-${version}.tar.gz"
  local base_url="https://github.com/${repo}/releases/download/v${version}"
  local tmp_dir="$STAGE/release-dl"

  rm -rf "$tmp_dir"
  mkdir -p "$tmp_dir"

  log "downloading prebuilt ${tarball_name} from ${repo}@v${version}"
  curl -fsSL "${base_url}/${tarball_name}" -o "${tmp_dir}/${tarball_name}" || return 1
  curl -fsSL "${base_url}/${tarball_name}.sha256" -o "${tmp_dir}/${tarball_name}.sha256" || return 1

  local expected_sha actual_sha
  expected_sha="$(awk '{print $1}' "${tmp_dir}/${tarball_name}.sha256" | head -n1)"
  actual_sha="$(sha256sum "${tmp_dir}/${tarball_name}" | awk '{print $1}')"
  if [ -z "$expected_sha" ] || [ "$expected_sha" != "$actual_sha" ]; then
    log "SHA-256 mismatch for ${tarball_name} (expected ${expected_sha}, got ${actual_sha})"
    return 1
  fi

  tar -xzf "${tmp_dir}/${tarball_name}" -C "$tmp_dir"
  local extracted
  extracted="$(find "$tmp_dir" -type f \( -name 'jean-server' -o -name 'jean-server-linux-*' \) | head -n1 || true)"
  [ -n "$extracted" ] || return 1
  cp "$extracted" "$out_bin"
  chmod 755 "$out_bin"
}

build_server_from_source() {
  local out_bin="$1"
  log "building jean-server from source (cargo build --release --manifest-path src-server/Cargo.toml)"
  RUSTC_WRAPPER= cargo build --release --locked --manifest-path "$ROOT/src-server/Cargo.toml"
  local built="$ROOT/src-server/target/release/jean-server"
  [ -x "$built" ] || die "cargo build succeeded but ${built} is missing or not executable"
  cp "$built" "$out_bin"
  chmod 755 "$out_bin"
}

main() {
  exec 9>"$LOCK"
  if ! flock -n 9; then
    die "another dante-build is already running (lock: ${LOCK#"$ROOT"/})"
  fi

  trap 'rm -rf "$STAGE"' EXIT

  if [ -d "$BACKUP" ] && [ -n "$(find "$BACKUP" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    die "a previous run left builds in ${BACKUP#"$ROOT"/} — restore or remove it by hand, then re-run."
  fi

  rm -rf "$STAGE" "$BACKUP"
  mkdir -p "$STAGE"

  local version git_sha built_at
  version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
  git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  log "installing frontend dependencies (bun install --frozen-lockfile)"
  bun install --frozen-lockfile

  log "typechecking and building frontend into staging ($STAGE/dist)"
  bunx tsc --noEmit
  bunx vite build --outDir "$STAGE/dist"
  touch "$STAGE/dist/.gitkeep"

  node -e '
    const fs = require("fs");
    const [outPath, version, gitSha, builtAt] = process.argv.slice(1);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          webBuildId: `${version}-${gitSha}`,
          appVersion: version,
          gitSha,
          builtAt,
        },
        null,
        2
      ) + "\n"
    );
  ' "$STAGE/dist/jean-build.json" "$version" "$git_sha" "$built_at"

  [ -s "$STAGE/dist/index.html" ] || die "staged frontend build missing index.html"
  [ -s "$STAGE/dist/jean-build.json" ] || die "staged frontend build missing jean-build.json"

  log "swapping staged dist/ into place"
  mkdir -p "$BACKUP"
  if [ -d "$ROOT/dist" ]; then
    mv "$ROOT/dist" "$BACKUP/dist"
  fi
  if ! mv "$STAGE/dist" "$ROOT/dist"; then
    if [ -d "$BACKUP/dist" ]; then
      mv "$BACKUP/dist" "$ROOT/dist" || true
    fi
    die "failed to move staged dist/ into place; rolled back"
  fi
  rm -rf "$BACKUP"

  mkdir -p "$ROOT/bin"
  local rust_hash cached_hash
  rust_hash="$(compute_rust_hash)"
  cached_hash="$(cat "$ROOT/bin/.rust-hash" 2>/dev/null || true)"

  if [ "${JEAN_FORCE_CARGO_BUILD:-0}" != "1" ] && [ -x "$ROOT/bin/jean-server" ] && [ "$rust_hash" = "$cached_hash" ]; then
    log "bin/jean-server is up to date (rust hash ${rust_hash:0:12})"
  else
    local staged_bin="$STAGE/jean-server"
    if [ "${JEAN_FORCE_CARGO_BUILD:-0}" != "1" ] && rust_matches_upstream_tag "v${version}"; then
      if ! download_prebuilt_server "$version" "$staged_bin"; then
        log "prebuilt download unavailable; falling back to local cargo build"
        build_server_from_source "$staged_bin"
      fi
    else
      build_server_from_source "$staged_bin"
    fi

    "$staged_bin" --version >/dev/null 2>&1 || [ -x "$staged_bin" ] || die "staged jean-server binary is not runnable"
    mv "$staged_bin" "$ROOT/bin/jean-server"
    printf '%s\n' "$rust_hash" >"$ROOT/bin/.rust-hash"
    log "installed bin/jean-server (rust hash ${rust_hash:0:12})"
  fi

  log "dante-build complete (version=${version}, sha=${git_sha})"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
