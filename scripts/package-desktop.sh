#!/bin/sh

set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
native_dir="$project_dir/native-shell"
native_sdk_dir="$project_dir/node_modules/@native-sdk/cli"
package_dir="$native_dir/zig-out/package"
output_dir="$project_dir/dist-desktop"
output_app="$output_dir/duolingua.app"

cd "$project_dir"

test -d .cache || {
  echo "Translation models are missing. Run: pnpm models:fetch" >&2
  exit 1
}

pnpm build

(
  cd "$native_dir"
  PATH="$project_dir/node_modules/.bin:$PATH" zig build package \
    -Dnative-sdk-path="$native_sdk_dir" \
    -Dpackage-target=macos
)

source_app="$(find "$package_dir" -maxdepth 1 -type d -name '*.app' -print -quit)"
test -n "$source_app"

rm -rf "$output_app"
mkdir -p "$output_dir"
ditto "$source_app" "$output_app"

contents_dir="$output_app/Contents"
resources_dir="$contents_dir/Resources"
server_dir="$resources_dir/server"

mv "$contents_dir/MacOS/native-shell" "$contents_dir/MacOS/duolingua-native"
xcrun clang -Os "$native_dir/launcher/desktop-launcher.c" \
  -o "$contents_dir/MacOS/duolingua"
plutil -replace CFBundleExecutable -string duolingua "$contents_dir/Info.plist"

mkdir -p "$server_dir/.next" "$resources_dir/runtime" "$resources_dir/launcher"
ditto "$project_dir/.next/standalone" "$server_dir"
ditto "$project_dir/.next/static" "$server_dir/.next/static"
ditto "$project_dir/data/dict" "$server_dir/data/dict"
ditto "$project_dir/.cache" "$resources_dir/models"
install -m 755 "$(node -p 'process.execPath')" "$resources_dir/runtime/node"
install -m 644 "$native_dir/launcher/desktop-launcher.mjs" \
  "$resources_dir/launcher/desktop-launcher.mjs"

# Next's pnpm trace can retain optional workspace links whose targets were not
# selected for the standalone server. They are unused at runtime, and macOS
# refuses to validate a signed bundle containing dangling symlinks.
find "$server_dir" -type l | while IFS= read -r link; do
  test -e "$link" || rm "$link"
done

codesign --deep --force --sign - "$output_app"
codesign --verify --deep --strict "$output_app"

echo "$output_app"
