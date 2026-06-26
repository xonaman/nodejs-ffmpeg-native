import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withConcurrency } from './concurrency.js';
import { parseNativeError } from './errors.js';
import type { NativeAddon, TranscodeOptions } from './types.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// everything is statically linked into ffmpeg.node, but keep the addon dir on
// the loader path for parity with the other native addons.
const addonDir = resolve(__dirname, '..', 'build', 'Release');
if (process.platform === 'win32') {
  process.env.PATH = `${addonDir};${process.env.PATH ?? ''}`;
} else {
  process.env.LD_LIBRARY_PATH = `${addonDir}:${process.env.LD_LIBRARY_PATH ?? ''}`;
}

const addon: NativeAddon = require('../build/Release/ffmpeg.node');

type VideoInput = Buffer | string;

/**
 * Transcodes and normalizes a video to a web-ready MP4 (H.264 + AAC).
 *
 * The output is always `yuv420p` H.264 with a relocated `moov` atom
 * (`+faststart`) so it plays in browsers and starts before the full download.
 * By default the video is scaled down to at most 720p (aspect ratio preserved,
 * never upscaled) at a bitrate derived from the output resolution. Audio is
 * re-encoded to AAC.
 *
 * Pass `options.output` to write straight to a file path and skip the
 * in-memory result buffer.
 */
export function transcode(
  input: VideoInput,
  options: TranscodeOptions & { output: string },
): Promise<void>;
export function transcode(input: VideoInput, options?: TranscodeOptions): Promise<Buffer>;
export async function transcode(
  input: VideoInput,
  options?: TranscodeOptions,
): Promise<Buffer | void> {
  if (Buffer.isBuffer(input)) {
    if (input.length === 0) {
      throw new TypeError('Input buffer cannot be empty');
    }
  } else if (typeof input === 'string') {
    if (input.length === 0) {
      throw new TypeError('Input path cannot be empty');
    }
  } else {
    throw new TypeError('Input must be a Buffer or file path string');
  }

  try {
    return (await withConcurrency(() =>
      addon.transcode(input, {
        ...(options?.maxHeight !== undefined ? { maxHeight: options.maxHeight } : {}),
        ...(options?.maxWidth !== undefined ? { maxWidth: options.maxWidth } : {}),
        ...(options?.videoBitrate !== undefined ? { videoBitrate: options.videoBitrate } : {}),
        ...(options?.audioBitrate !== undefined ? { audioBitrate: options.audioBitrate } : {}),
        ...(options?.faststart !== undefined ? { faststart: options.faststart } : {}),
        ...(options?.output ? { output: options.output } : {}),
      }),
    )) as Buffer | void;
  } catch (err) {
    throw parseNativeError(err);
  }
}

export { concurrency } from './concurrency.js';
export {
  FFmpegError,
  FFmpegInputError,
  FFmpegUnsupportedError,
  FFmpegDecodeError,
  FFmpegEncodeError,
  FFmpegOutputError,
} from './errors.js';
export type { TranscodeOptions } from './types.js';
