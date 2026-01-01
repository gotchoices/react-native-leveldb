#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/cpp/leveldb"

usage() {
  cat <<'EOF'
Usage:
  scripts/update-leveldb.sh --ref <git-ref> [--repo <git-url>]

Example:
  scripts/update-leveldb.sh --ref 1.23 --repo https://github.com/google/leveldb.git

Notes:
- This is a maintainer script. It requires git + network access.
- It refreshes the vendored LevelDB source in cpp/leveldb and strips nested .git metadata.
- After running, review diffs and run rn-leveldb builds/tests before publishing.
EOF
}

REPO_URL="https://github.com/google/leveldb.git"
REF=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --ref)
      REF="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$REF" ]]; then
  echo "Missing required --ref <git-ref>" >&2
  usage >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Cloning LevelDB: $REPO_URL @ $REF"
git clone --depth 1 --branch "$REF" "$REPO_URL" "$TMP_DIR/leveldb"

echo "Replacing vendored LevelDB at: $TARGET_DIR"
rm -rf "$TARGET_DIR"
mkdir -p "$(dirname "$TARGET_DIR")"
cp -R "$TMP_DIR/leveldb" "$TARGET_DIR"

echo "Stripping git metadata from vendored copy"
rm -rf "$TARGET_DIR/.git" "$TARGET_DIR/.gitmodules" || true
rm -rf "$TARGET_DIR/third_party/googletest/.git" "$TARGET_DIR/third_party/benchmark/.git" || true
rm -rf "$TARGET_DIR/third_party/googletest/.gitmodules" "$TARGET_DIR/third_party/benchmark/.gitmodules" || true

echo "Done. Next steps:"
echo "  - Review changes under cpp/leveldb"
echo "  - Run: yarn && yarn typescript && yarn test (and build the example app)"


