# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

### Added

- `transcode()` — normalize any input video to a web-ready, faststart H.264/AAC
  MP4 with height-capped scaling and target-bitrate rate control, off the main
  thread via N-API.
- H.264 encoding via OpenH264 (BSD); FFmpeg built without `--enable-gpl`, so the
  package is MIT-licensed.
- Buffer and file-path input/output.
- Prebuilt binaries for macOS (x64/arm64), Linux glibc + musl (x64/arm64), and
  Windows (x64). The Windows build links FFmpeg + OpenH264 from vcpkg (stock
  LGPL FFmpeg 8.x) rather than the source-built 7.1.1 used elsewhere.
- Requires Node.js 22 or newer.

### Security

- Pin and verify the SHA-256 of every source-built native dependency (FFmpeg
  7.1.1, OpenH264 2.4.1) via `scripts/native-deps.json` and a hardened downloader
  (per-attempt timeout, exponential-backoff retry, atomic writes, origin
  pinning), with an `npm run verify:checksums` supply-chain tripwire.
- Hardened archive extraction: tar runs without `-P` (no absolute/`..` paths) or
  archived ownership, and with stdin redirected so a spawned decompressor cannot
  deadlock on Windows.
- Added OpenSSF Scorecard scanning.

### Changed

- Hardened CI/CD: pinned all GitHub Actions to commit SHAs, added npm and
  native-dependency caching, and gated the release workflow behind the
  format/lint/typecheck/test suite (previously it published without those checks).
- Publish tokenlessly via npm OIDC trusted publishing (`npm publish
  --provenance`, no `NPM_TOKEN`).
- Added a weekly `windows-latest` canary job that re-tests the `windows-2022`
  pin so it can be dropped once VS 2026's MSVC builds the addon again.
