# Changelog

## 0.1.0

- Initial release.
- `transcode()` — normalize any input video to a web-ready, faststart H.264/AAC MP4
  with height-capped scaling and target-bitrate rate control, off the main thread
  via N-API.
- H.264 encoding via OpenH264 (BSD); FFmpeg built without `--enable-gpl`, so the
  package is MIT-licensed.
- Buffer and file-path input/output.
- Prebuilt binaries for macOS (x64/arm64) and Linux glibc + musl (x64/arm64).
