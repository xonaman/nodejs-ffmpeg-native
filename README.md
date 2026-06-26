# ffmpeg-native

[![Node.js](https://img.shields.io/node/v/ffmpeg-native)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)]()

Native video transcoding for Node.js — powered by [FFmpeg](https://ffmpeg.org/)
and [OpenH264](https://github.com/cisco/openh264). Built as a C++ addon with
N-API for ABI stability across Node.js versions.

Normalizes arbitrary user-uploaded video into a single, predictable,
web-playable shape: **H.264 (yuv420p) + AAC in an MP4 with `+faststart`**,
downscaled to a height cap and re-encoded at a target bitrate — the video
analogue of converting every image upload to a sane JPEG.

> Designed for server-side workloads. Non-blocking, fully in-process (no shell
> out to the `ffmpeg` CLI), and statically linked into a single `.node`.

## Quick start

```typescript
import { transcode } from 'ffmpeg-native';

// returns a normalized MP4 Buffer (defaults: 1280×720 box, derived bitrate, faststart)
const mp4 = await transcode(inputBuffer);

// or write straight to a file path (skips the in-memory result)
await transcode(inputBuffer, { output: '/tmp/normalized.mp4' });

// file path input works too
const out = await transcode('/tmp/upload.mov', { maxHeight: 1080, videoBitrate: 4_000_000 });
```

## API

### `transcode(input, options?)`

- `input`: `Buffer | string` — the source video bytes, or a path to read from.
- Returns: `Promise<Buffer>`, or `Promise<void>` when `options.output` is set.

#### `TranscodeOptions`

| Option         | Type      | Default  | Description                                                                 |
| -------------- | --------- | -------- | --------------------------------------------------------------------------- |
| `maxHeight`    | `number`  | `720`    | Cap output height (aspect ratio preserved, never upscaled). `0` = keep      |
| `maxWidth`     | `number`  | `1280`   | Cap output width; with `maxHeight` the video fits a 1280×720 box. `0` = off |
| `videoBitrate` | `number`  | derived  | Target H.264 bitrate (bits/s); derived from resolution when omitted         |
| `audioBitrate` | `number`  | `128000` | Target AAC bitrate (bits/s)                                                 |
| `faststart`    | `boolean` | `true`   | Move the `moov` atom to the front for progressive playback                  |
| `output`       | `string`  | —        | Write to this path instead of returning a Buffer                            |

### Errors

Failures reject with a typed `FFmpegError` subclass carrying a `.code`:
`FFmpegInputError` (`INPUT`), `FFmpegUnsupportedError` (`UNSUPPORTED`),
`FFmpegDecodeError` (`DECODE`), `FFmpegEncodeError` (`ENCODE`),
`FFmpegOutputError` (`OUTPUT`).

## Supported platforms

Prebuilt binaries: **macOS** (x64, arm64) and **Linux** glibc + musl/Alpine
(x64, arm64). On other platforms `npm install` compiles OpenH264 and a minimal
static FFmpeg from source (requires `nasm`, `pkg-config`, a C/C++ toolchain,
and `make`). Windows is not currently supported.

## How it works

`npm install` downloads a prebuilt `ffmpeg.node` from GitHub releases. If none
matches the platform, it falls back to:

1. `scripts/download-openh264.mjs` — build a static `libopenh264.a`.
2. `scripts/download-ffmpeg.mjs` — build a minimal static FFmpeg (only the
   demuxers/decoders/encoders needed to normalize uploads) linked against
   OpenH264.
3. `node-gyp rebuild` — compile the addon, statically linking everything into a
   single self-contained `ffmpeg.node`.

## License

MIT (see [LICENSE](./LICENSE)). The prebuilt binary statically links FFmpeg
(LGPL-2.1-or-later, built without `--enable-gpl`) and OpenH264 (BSD-2-Clause);
build scripts are included so the LGPL relinking requirement is satisfied.
