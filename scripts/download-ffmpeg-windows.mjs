/**
 * Builds FFmpeg + OpenH264 for Windows via vcpkg and copies the static libs and
 * headers into deps/ so binding.gyp's OS=='win' branch can link them.
 *
 * Unlike macOS/Linux (which build FFmpeg n7.1.1 from source with a curated
 * --disable-everything allowlist), Windows uses vcpkg's stock FFmpeg port: a
 * newer FFmpeg (8.x) with a larger but functionally-superset codec set. It stays
 * LGPL — no gpl/nonfree features — with H.264 encode via OpenH264 (BSD), exactly
 * like the other platforms.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const ffmpegDir = join(root, 'deps', 'ffmpeg');
const openh264Dir = join(root, 'deps', 'openh264');

if (process.platform !== 'win32') {
  console.error('download-ffmpeg-windows.mjs is Windows-only; use download-ffmpeg.mjs elsewhere.');
  process.exit(1);
}

if (existsSync(join(ffmpegDir, 'lib', 'avcodec.lib'))) {
  console.log('FFmpeg (Windows) already built, skipping.');
  process.exit(0);
}

const triplet = process.env.VCPKG_TARGET_TRIPLET || `${process.arch}-windows-static`;
const vcpkgRoot = process.env.VCPKG_ROOT || 'C:\\vcpkg';
const vcpkgExe = join(vcpkgRoot, 'vcpkg.exe');

if (!existsSync(vcpkgExe)) {
  console.error(`vcpkg not found at ${vcpkgExe}. Set VCPKG_ROOT to your vcpkg install.`);
  process.exit(1);
}

// LGPL build: avcodec/avformat/avutil/swscale/swresample + the OpenH264 (BSD)
// H.264 encoder + zlib (png/mov). `core` drops the avdevice/avfilter defaults we
// never use; no gpl/nonfree features keeps it LGPL like the source builds.
const pkg = `ffmpeg[core,avcodec,avformat,swresample,swscale,openh264,zlib]:${triplet}`;

console.log(`Installing ${pkg} via vcpkg...`);
execFileSync(vcpkgExe, ['install', pkg, '--clean-after-build'], { stdio: 'inherit' });

const installed = join(vcpkgRoot, 'installed', triplet);
const libSrc = join(installed, 'lib');
const incSrc = join(installed, 'include');
if (!existsSync(libSrc)) {
  console.error(`vcpkg install dir not found: ${libSrc}`);
  process.exit(1);
}

mkdirSync(join(ffmpegDir, 'lib'), { recursive: true });
mkdirSync(join(ffmpegDir, 'include'), { recursive: true });
mkdirSync(join(openh264Dir, 'lib'), { recursive: true });

// the FFmpeg static libs + headers binding.gyp links and includes
for (const lib of ['avcodec.lib', 'avformat.lib', 'avutil.lib', 'swscale.lib', 'swresample.lib']) {
  cpSync(join(libSrc, lib), join(ffmpegDir, 'lib', lib));
  console.log(`Copied ${lib}`);
}
cpSync(incSrc, join(ffmpegDir, 'include'), { recursive: true });

// OpenH264 installs as openh264.lib; binding.gyp links it from deps/openh264/lib.
cpSync(join(libSrc, 'openh264.lib'), join(openh264Dir, 'lib', 'openh264.lib'));
console.log('Copied openh264.lib');

// vcpkg's static zlib lib name varies by version (zlib.lib / zs.lib /
// zlibstatic.lib); copy whichever exists to the zlib.lib name binding.gyp links.
const zlibSrc = ['zlib.lib', 'zs.lib', 'zlibstatic.lib']
  .map((n) => join(libSrc, n))
  .find((p) => existsSync(p));
if (!zlibSrc) {
  console.error(`zlib static lib not found in ${libSrc}. Contents:`, readdirSync(libSrc));
  process.exit(1);
}
cpSync(zlibSrc, join(ffmpegDir, 'lib', 'zlib.lib'));
console.log(`Copied ${zlibSrc} -> deps/ffmpeg/lib/zlib.lib`);

console.log(`FFmpeg (Windows, ${triplet}) installed to ${ffmpegDir}`);
