/** Base error for all FFmpeg operations. */
export class FFmpegError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FFmpegError';
    this.code = code;
  }
}

/** Thrown when the input file cannot be found, opened, or read. */
export class FFmpegInputError extends FFmpegError {
  constructor(message: string) {
    super('INPUT', message);
    this.name = 'FFmpegInputError';
  }
}

/** Thrown when the input has no usable stream or uses an unsupported codec. */
export class FFmpegUnsupportedError extends FFmpegError {
  constructor(message: string) {
    super('UNSUPPORTED', message);
    this.name = 'FFmpegUnsupportedError';
  }
}

/** Thrown when decoding the input fails. */
export class FFmpegDecodeError extends FFmpegError {
  constructor(message: string) {
    super('DECODE', message);
    this.name = 'FFmpegDecodeError';
  }
}

/** Thrown when encoding the output fails. */
export class FFmpegEncodeError extends FFmpegError {
  constructor(message: string) {
    super('ENCODE', message);
    this.name = 'FFmpegEncodeError';
  }
}

/** Thrown when writing the output (file or buffer) fails. */
export class FFmpegOutputError extends FFmpegError {
  constructor(message: string) {
    super('OUTPUT', message);
    this.name = 'FFmpegOutputError';
  }
}

export function parseNativeError(err: unknown): FFmpegError {
  const msg = err instanceof Error ? err.message : String(err);
  const colonIdx = msg.indexOf(':');
  if (colonIdx === -1) return new FFmpegError('UNKNOWN', msg);

  const code = msg.slice(0, colonIdx);
  const text = msg.slice(colonIdx + 1).trimStart();

  switch (code) {
    case 'INPUT':
      return new FFmpegInputError(text);
    case 'UNSUPPORTED':
      return new FFmpegUnsupportedError(text);
    case 'DECODE':
      return new FFmpegDecodeError(text);
    case 'ENCODE':
      return new FFmpegEncodeError(text);
    case 'OUTPUT':
      return new FFmpegOutputError(text);
    default:
      return new FFmpegError(code, text);
  }
}
