import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { downloadFile, extractTarball, loadManifest } from './lib/integrity.mjs';

const { ffmpeg: dep } = loadManifest();
const FFMPEG_VERSION = dep.version;

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
  console.error(
    'On Windows, build FFmpeg via vcpkg: run "node scripts/download-ffmpeg-windows.mjs".',
  );
  process.exit(1);
}

if (!existsSync(join(openh264Dir, 'lib', 'libopenh264.a'))) {
  console.error('OpenH264 not found — run "node scripts/download-openh264.mjs" first.');
  process.exit(1);
}

const tag = `n${FFMPEG_VERSION}`;
const tarball = join(root, `ffmpeg-${FFMPEG_VERSION}.tar.gz`);
const srcDir = join(root, `FFmpeg-${tag}`);

// step 1: download (origin- and SHA-256-pinned via native-deps.json)
console.log(`Downloading FFmpeg ${FFMPEG_VERSION}...`);
console.log(`URL: ${dep.url}`);

mkdirSync(join(root, 'deps'), { recursive: true });
await downloadFile(dep.url, tarball, { expectedSha256: dep.sha256, allowedOrigin: dep.origin });
console.log('Checksum verified. Extracting...');
extractTarball(tarball, root);
rmSync(tarball, { force: true });

// GitHub archive tarballs extract to `FFmpeg-{tag}` — find it if the name differs
if (!existsSync(srcDir)) {
  const candidates = readdirSync(root).filter(
    (d) => d.toLowerCase().startsWith('ffmpeg-') && !d.endsWith('.tar.gz'),
  );
  const match = candidates.find((d) => d.includes(tag) || d.includes(FFMPEG_VERSION));
  if (match) {
    renameSync(join(root, match), srcDir);
    console.log(`Renamed ${match} → FFmpeg-${tag}`);
  } else {
    console.error(
      `Could not find extracted FFmpeg source directory. Found: ${candidates.join(', ')}`,
    );
    process.exit(1);
  }
}

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
  // -fPIC is required so the static libs link into our shared .node (avoids
  // "relocation R_X86_64_PC32 ... can not be used when making a shared object").
  `--extra-cflags=-fPIC -I${join(openh264Dir, 'include')}`,
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
