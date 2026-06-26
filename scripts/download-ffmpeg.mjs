import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const FFMPEG_VERSION = '7.1.1';
const BASE_URL = 'https://github.com/FFmpeg/FFmpeg/archive/refs/tags';

const root = join(import.meta.dirname, '..');
const depsDir = join(root, 'deps', 'ffmpeg');
const openh264Dir = join(root, 'deps', 'openh264');

if (existsSync(join(depsDir, 'lib', 'libavcodec.a'))) {
  console.log('FFmpeg already built, skipping.');
  process.exit(0);
}

// validate version to prevent SSRF
if (!/^\d+\.\d+(\.\d+)?$/.test(FFMPEG_VERSION)) {
  console.error(`Invalid FFmpeg version: ${FFMPEG_VERSION}`);
  process.exit(1);
}

if (process.platform === 'win32') {
  console.error('FFmpeg source build is not supported on Windows in this package.');
  process.exit(1);
}

if (!existsSync(join(openh264Dir, 'lib', 'libopenh264.a'))) {
  console.error('OpenH264 not found — run "node scripts/download-openh264.mjs" first.');
  process.exit(1);
}

const tag = `n${FFMPEG_VERSION}`;
const url = `${BASE_URL}/${tag}.tar.gz`;
const tarball = join(root, `ffmpeg-${FFMPEG_VERSION}.tar.gz`);
const srcDir = join(root, `FFmpeg-${tag}`);

console.log(`Downloading FFmpeg ${FFMPEG_VERSION}...`);
console.log(`URL: ${url}`);

const response = await fetch(url, { redirect: 'follow' });
if (!response.ok) {
  console.error(`Download failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

mkdirSync(join(root, 'deps'), { recursive: true });
await pipeline(Readable.fromWeb(response.body), createWriteStream(tarball));

console.log('Extracting...');
execFileSync('tar', ['-xzf', tarball, '-C', root], { stdio: 'inherit' });
rmSync(tarball);

// help FFmpeg's configure find our static OpenH264 via pkg-config
const pkgConfigDir = join(openh264Dir, 'lib', 'pkgconfig');
const existing = process.env.PKG_CONFIG_PATH || '';
process.env.PKG_CONFIG_PATH = existing ? `${pkgConfigDir}:${existing}` : pkgConfigDir;

// minimal build: only the demuxers/decoders/encoders/muxer we actually need to
// normalize arbitrary user uploads into web-ready H.264/AAC MP4.
const components = [
  '--enable-protocol=file',
  '--enable-demuxer=mov,matroska,avi,flv,mpegts,mpegps,ogg,wav,mp3,aac,flac,mjpeg,gif,image2',
  '--enable-decoder=h264,hevc,mpeg4,mpeg2video,vp8,vp9,theora,mjpeg,png,gif,aac,mp3float,opus,vorbis,flac,ac3,pcm_s16le,pcm_s16be,pcm_u8,pcm_f32le,pcm_s24le',
  '--enable-parser=h264,hevc,aac,mpeg4video,vp8,vp9,opus,mpegaudio,mjpeg',
  '--enable-encoder=libopenh264,aac',
  '--enable-muxer=mp4',
  '--enable-bsf=extract_extradata,h264_mp4toannexb,aac_adtstoasc',
];

const configureArgs = [
  `--prefix=${depsDir}`,
  '--disable-shared',
  '--enable-static',
  '--enable-pic',
  '--enable-libopenh264',
  // --disable-autodetect turns zlib off; re-enable it explicitly since the png
  // decoder/encoder (and some demuxers) require it and we request png above.
  '--enable-zlib',
  '--disable-programs',
  '--disable-doc',
  '--disable-debug',
  '--disable-autodetect',
  '--disable-everything',
  ...components,
  `--extra-cflags=-I${join(openh264Dir, 'include')}`,
  `--extra-ldflags=-L${join(openh264Dir, 'lib')}`,
  '--pkg-config-flags=--static',
];

if (process.env.FFMPEG_CONFIGURE_EXTRA) {
  configureArgs.push(...process.env.FFMPEG_CONFIGURE_EXTRA.split(' ').filter(Boolean));
}

console.log('Configuring FFmpeg...');
execFileSync('./configure', configureArgs, { stdio: 'inherit', cwd: srcDir });

console.log('Building FFmpeg...');
// bound parallelism to the core count; unbounded `make -j` exhausts the macOS
// runner's process limit (posix_spawn: Resource temporarily unavailable).
execFileSync('make', ['-j' + availableParallelism()], { stdio: 'inherit', cwd: srcDir });
execFileSync('make', ['install'], { stdio: 'inherit', cwd: srcDir });

rmSync(srcDir, { recursive: true, force: true });

console.log(`FFmpeg ${FFMPEG_VERSION} installed to ${depsDir}`);
