export interface TranscodeOptions {
  /**
   * Cap the output height in pixels, preserving aspect ratio. Width is derived
   * and rounded to an even number. The video is never upscaled. Default: 720.
   * Set to `0` to keep the source resolution.
   */
  readonly maxHeight?: number;
  /**
   * Cap the output width in pixels. Combined with `maxHeight`, the video is
   * scaled down to fit within the box (aspect ratio preserved, never upscaled).
   * Default: `0` (no width cap; width follows from `maxHeight`).
   */
  readonly maxWidth?: number;
  /**
   * Target H.264 video bitrate in bits per second. When omitted, a bitrate is
   * derived from the output resolution and frame rate.
   */
  readonly videoBitrate?: number;
  /**
   * Target AAC audio bitrate in bits per second. Default: 128000.
   */
  readonly audioBitrate?: number;
  /**
   * Relocate the MP4 `moov` atom to the front so playback can start before the
   * whole file is downloaded (progressive streaming). Default: true.
   */
  readonly faststart?: boolean;
  /** Write to this file path instead of returning a Buffer. */
  readonly output?: string;
}

export interface NativeAddon {
  transcode(
    input: Buffer | string,
    options: {
      maxHeight?: number;
      maxWidth?: number;
      videoBitrate?: number;
      audioBitrate?: number;
      faststart?: boolean;
      output?: string;
    },
  ): Promise<Buffer | undefined>;
}
