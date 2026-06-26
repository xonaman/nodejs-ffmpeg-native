#pragma once

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <vector>

extern "C" {
#include <libavformat/avio.h>
#include <libavutil/error.h>
}

// ---------------------------------------------------------------------------
// In-memory AVIO adapters
// ---------------------------------------------------------------------------
// Lets libavformat read the input from a Buffer and write the output to a
// growable byte vector without ever touching the filesystem. Both expose a
// seek callback so the MP4 muxer's +faststart pass (which rewrites the moov
// atom to the front of the file) works on in-memory output.

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

// growable, seekable, read+write sink for output. Read is required so the
// muxer's faststart pass can shift previously written data forward.
struct WriteBuffer {
  std::vector<uint8_t> data;
  int64_t pos = 0;

  // the callback runs inside libavformat (C); a std::bad_alloc must not unwind
  // through C frames, so convert allocation failure into an AVERROR.
  static int write(void *opaque, const uint8_t *buf, int bufSize) noexcept {
    auto *w = static_cast<WriteBuffer *>(opaque);
    try {
      if (w->pos + bufSize > static_cast<int64_t>(w->data.size()))
        w->data.resize(static_cast<size_t>(w->pos + bufSize));
    } catch (...) {
      return AVERROR(ENOMEM);
    }
    std::memcpy(w->data.data() + w->pos, buf, bufSize);
    w->pos += bufSize;
    return bufSize;
  }

  static int read(void *opaque, uint8_t *buf, int bufSize) noexcept {
    auto *w = static_cast<WriteBuffer *>(opaque);
    int64_t avail = static_cast<int64_t>(w->data.size()) - w->pos;
    if (avail <= 0)
      return AVERROR_EOF;
    int n = static_cast<int>(avail < bufSize ? avail : bufSize);
    std::memcpy(buf, w->data.data() + w->pos, n);
    w->pos += n;
    return n;
  }

  static int64_t seek(void *opaque, int64_t offset, int whence) noexcept {
    auto *w = static_cast<WriteBuffer *>(opaque);
    if (whence == AVSEEK_SIZE)
      return static_cast<int64_t>(w->data.size());
    int64_t np;
    switch (whence) {
    case SEEK_SET:
      np = offset;
      break;
    case SEEK_CUR:
      np = w->pos + offset;
      break;
    case SEEK_END:
      np = static_cast<int64_t>(w->data.size()) + offset;
      break;
    default:
      return -1;
    }
    if (np < 0)
      return -1;
    w->pos = np;
    return np;
  }
};
