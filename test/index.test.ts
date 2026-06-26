import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { transcode, FFmpegInputError } from '../lib/index.js';

const fixtures = join(import.meta.dirname, 'fixtures');

/** Returns true when the buffer is an MP4 (an `ftyp` box at offset 4). */
function isMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
}

const candidates = ['h264-1080p.mp4', 'hevc-720p.mov', 'vp9-720p.webm', 'h264-noaudio.mp4'].filter(
  (name) => existsSync(join(fixtures, name)),
);

const tempFiles: string[] = [];
function tempPath(name: string) {
  const p = join(tmpdir(), `ffmpeg-native-test-${process.pid}-${name}`);
  tempFiles.push(p);
  return p;
}
afterEach(() => {
  for (const f of tempFiles) {
    try {
      unlinkSync(f);
    } catch {}
  }
  tempFiles.length = 0;
});

describe('transcode', () => {
  it.runIf(candidates.length > 0)('has fixtures to test', () => {
    expect(candidates.length).toBeGreaterThan(0);
  });

  for (const name of candidates) {
    describe(name, () => {
      const input = readFileSync(join(fixtures, name));

      it('returns a faststart MP4 buffer', async () => {
        const out = await transcode(input);
        expect(Buffer.isBuffer(out)).toBe(true);
        expect(isMp4(out)).toBe(true);
      });

      it('accepts a file path as input', async () => {
        const out = await transcode(join(fixtures, name));
        expect(isMp4(out)).toBe(true);
      });

      it('writes to a file path when output is given', async () => {
        const outPath = tempPath(`${name}.out.mp4`);
        const ret = await transcode(input, { output: outPath });
        expect(ret).toBeUndefined();
        expect(existsSync(outPath)).toBe(true);
        expect(statSync(outPath).size).toBeGreaterThan(0);
        expect(isMp4(readFileSync(outPath))).toBe(true);
      });

      it('respects a custom height cap', async () => {
        const out = await transcode(input, { maxHeight: 240 });
        expect(isMp4(out)).toBe(true);
      });
    });
  }

  it('rejects an empty buffer', async () => {
    await expect(transcode(Buffer.alloc(0))).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects invalid input with a typed error', async () => {
    await expect(transcode(Buffer.from('not a video file at all'))).rejects.toBeInstanceOf(
      FFmpegInputError,
    );
  });
});
