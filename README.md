# duolingua

duolingua is a focused translator for German, English, Spanish and Chinese.

Paste a sentence in any of the four languages to read it in the other three.
German text also gets a word-by-word breakdown with lemmas, parts of speech,
case, gender and tense.

Translation runs privately on your Mac. The desktop app bundles its translation
models and dictionary, so no text is sent to a third-party translation service.

Download the macOS installer from [GitHub Releases](https://github.com/huozhi/duolingua/releases/latest).
The website is a simple introduction; translation is available in the desktop app.

[Design and development details](docs/design.md)

## Releasing the macOS app

The [release workflow](.github/workflows/release-desktop.yml) builds separate Apple Silicon and
Intel DMGs, verifies their checksums, and publishes them to a GitHub Release. To publish a version:

1. Set the same `X.Y.Z` version in `package.json` and `native-shell/app.zon`.
2. Commit and push the version change.
3. Create and push the matching tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The workflow can also be run manually for an existing tag from the GitHub Actions page. Without
Apple credentials it produces an ad-hoc signed DMG. For a normal Gatekeeper-compatible download,
configure these repository Actions secrets:

- `MACOS_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_SIGNING_IDENTITY`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_PASSWORD`: an app-specific password
- `APPLE_TEAM_ID`
