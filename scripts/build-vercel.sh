#!/usr/bin/env bash
set -euo pipefail

mode=${1:-build}
bun_version=1.4.2
case "$(uname -m)" in
  x86_64)
    bun_dist=bun-linux-x64-baseline
    bun_sha=c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f
    ;;
  aarch64)
    bun_dist=bun-linux-aarch64
    bun_sha=54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7
    ;;
  *)
    printf 'Unsupported CPU architecture for Vercel build: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

download_verified() {
  curl --retry 3 -fsSL "$1" -o "$2"
  printf '%s  %s\n' "$3" "$2" | sha256sum --check --status
}

build_tmp=$(mktemp -d)
trap 'rm -rf -- "$build_tmp"' EXIT

bun_bin="$PWD/.vercel-build-tools/bun-$bun_version"
export PATH="$bun_bin:$PATH"
if [[ $(bun --version 2>/dev/null || true) != "$bun_version" ]]; then
  mkdir -p "$bun_bin"
  download_verified "https://github.com/oven-sh/bun/releases/download/bun-v${bun_version}/${bun_dist}.zip" \
    "$build_tmp/bun.zip" "$bun_sha"
  unzip -jo "$build_tmp/bun.zip" "$bun_dist/bun" -d "$bun_bin"
  chmod +x "$bun_bin/bun"
fi
printf 'Bun %s\n' "$(bun --version)"

if [[ $mode = install ]]; then
  bun install --frozen-lockfile
  exit
fi

export PATH="${HOME}/.cargo/bin:${PATH}"
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs |
    sh -s -- --yes --profile minimal --default-toolchain none
fi

rust_version=$(sed -n 's/^channel = "\([^"]*\)"$/\1/p' rust-toolchain.toml)
rustup toolchain install "$rust_version" --profile minimal --target wasm32-unknown-unknown --no-self-update

bun run build