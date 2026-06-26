/**
 * Generates test fixtures using a system FFmpeg (NOT this addon). Each fixture
 * is a small, deliberately un-normalized clip so the transcoder has something
 * real to scale down and re-encode. Codecs that the local ffmpeg lacks are
 * skipped — the test suite skips any fixture that is missing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const fixtures = join(import.meta.dirname, 'fixtures');
mkdirSync(fixtures, { recursive: true });

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
}

function tryGenerate(name, args) {
  const out = join(fixtures, name);
  if (existsSync(out)) {
    console.log(`${name} already exists, skipping.`);
    return;
  }
  try {
    ffmpeg([...args, out]);
    console.log(`Generated ${name}`);
  } catch {
    console.warn(`Could not generate ${name} (encoder unavailable) — skipping.`);
  }
}

// 1080p H.264 + AAC MP4 — exercises the downscale-to-720p path.
tryGenerate('h264-1080p.mp4', [
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1920x1080:rate=30:duration=2',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=2',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
]);

// 720p HEVC in a .mov container (iPhone-style) — exercises HEVC decode.
tryGenerate('hevc-720p.mov', [
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1280x720:rate=30:duration=2',
  '-c:v',
  'libx265',
  '-pix_fmt',
  'yuv420p',
  '-tag:v',
  'hvc1',
]);

// VP9 + Opus WebM — exercises WebM/VP9 decode.
tryGenerate('vp9-720p.webm', [
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1280x720:rate=30:duration=2',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=2',
  '-c:v',
  'libvpx-vp9',
  '-b:v',
  '1M',
  '-c:a',
  'libopus',
]);

// silent H.264 MP4 — exercises the video-only (no audio stream) path.
tryGenerate('h264-noaudio.mp4', [
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=640x480:rate=30:duration=1',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
]);
