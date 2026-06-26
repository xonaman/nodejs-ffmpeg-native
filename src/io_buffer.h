#pragma once

#include <cstdint>
#include <cstring>

extern "C" {
#include <libavformat/avio.h>
#include <libavutil/error.h>
}

// ---------------------------------------------------------------------------
// In-memory AVIO adapter
// ---------------------------------------------------------------------------
// Lets libavformat read the input from a Buffer without touching the
// filesystem. (Output is written to a temp file instead, because the MP4
// +faststart pass reopens the output URL, which a custom AVIO cannot provide.)

// read-only view over an input buffer
struct ReadBuffer {
  const uint8_t *data = nullptr;
  size_t size = 0;
  int64_t pos = 0;

  static int read(void *opaque, uint8_t *buf, int bufSize) noexcept {
    auto *r = static_cast<ReadBuffer *>(opaque);
    int64_t avail = static_cast<int64_t>(r->size) - r->pos;
    if (avail <= 0)
      return AVERROR_EOF;
    int n = static_cast<int>(avail < bufSize ? avail : bufSize);
    std::memcpy(buf, r->data + r->pos, n);
    r->pos += n;
    return n;
  }

  static int64_t seek(void *opaque, int64_t offset, int whence) noexcept {
    auto *r = static_cast<ReadBuffer *>(opaque);
    if (whence == AVSEEK_SIZE)
      return static_cast<int64_t>(r->size);
    int64_t np;
    switch (whence) {
    case SEEK_SET:
      np = offset;
      break;
    case SEEK_CUR:
      np = r->pos + offset;
      break;
    case SEEK_END:
      np = static_cast<int64_t>(r->size) + offset;
      break;
    default:
      return -1;
    }
    if (np < 0 || np > static_cast<int64_t>(r->size))
      return -1;
    r->pos = np;
    return np;
  }
};
