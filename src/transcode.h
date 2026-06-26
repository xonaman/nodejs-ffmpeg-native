#pragma once

#include <cstdint>
#include <string>
#include <vector>

// Options controlling the transcode. Mirrors the JS TranscodeOptions, with
// defaults already resolved by the caller.
struct TranscodeOptions {
  int maxHeight = 720;
  // Cap output width in pixels (0 = no width cap). Combined with maxHeight, the
  // video is scaled to fit within the box; aspect ratio is preserved.
  int maxWidth = 1280;
  // Target H.264 bitrate in bits/s. 0 = derive from output resolution/frame rate.
  int64_t videoBitrate = 0;
  int audioBitrate = 128000;
  bool faststart = true;
};

// Result of a transcode. `error` is empty on success, otherwise "CODE:message"
// where CODE is one of INPUT / UNSUPPORTED / DECODE / ENCODE / OUTPUT so the JS
// layer can map it to a typed error. `output` holds the MP4 bytes when no
// output file path was given; it is empty when writing to a file.
struct TranscodeResult {
  std::string error;
  std::vector<uint8_t> output;
};

// Runs the full demux -> decode -> scale/resample -> encode -> mux pipeline.
// Provide either `inPath` (when useFile is true) or the `inData`/`inSize`
// buffer. Provide `outPath` to write to a file, or leave it empty to return the
// bytes in TranscodeResult::output. This function performs no V8/N-API calls
// and is safe to run on a worker thread.
TranscodeResult RunTranscode(const uint8_t *inData, size_t inSize, const std::string &inPath,
                             bool useFile, const std::string &outPath,
                             const TranscodeOptions &opts);
