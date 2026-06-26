#include "transcode.h"

#include "io_buffer.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <unistd.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/audio_fifo.h>
#include <libavutil/channel_layout.h>
#include <libavutil/imgutils.h>
#include <libavutil/mathematics.h>
#include <libavutil/opt.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
}

namespace {

constexpr int kAvioBufferSize = 1 << 16;

std::string makeError(const char *code, const std::string &msg) {
  return std::string(code) + ":" + msg;
}

std::string avError(const char *code, const std::string &ctx, int ret) {
  char buf[AV_ERROR_MAX_STRING_SIZE] = {0};
  av_strerror(ret, buf, sizeof(buf));
  return std::string(code) + ":" + ctx + ": " + buf;
}

// Owns every libav resource for a single transcode and frees them in reverse
// dependency order. Using a destructor keeps the error paths free of manual
// cleanup.
struct Ctx {
  AVFormatContext *ifmt = nullptr;
  AVIOContext *inAvio = nullptr;
  AVFormatContext *ofmt = nullptr;
  bool fileOut = false;
  std::string tempPath; // temp output file for buffer mode (faststart needs a real file)
  ReadBuffer rb;

  AVCodecContext *vdec = nullptr;
  AVCodecContext *venc = nullptr;
  AVCodecContext *adec = nullptr;
  AVCodecContext *aenc = nullptr;

  SwsContext *sws = nullptr;
  SwrContext *swr = nullptr;
  AVAudioFifo *fifo = nullptr;

  AVFrame *decFrame = nullptr;
  AVFrame *scaledFrame = nullptr;
  AVPacket *pkt = nullptr;
  AVPacket *encPkt = nullptr;

  ~Ctx() {
    if (vdec)
      avcodec_free_context(&vdec);
    if (venc)
      avcodec_free_context(&venc);
    if (adec)
      avcodec_free_context(&adec);
    if (aenc)
      avcodec_free_context(&aenc);
    if (sws)
      sws_freeContext(sws);
    if (swr)
      swr_free(&swr);
    if (fifo)
      av_audio_fifo_free(fifo);
    if (decFrame)
      av_frame_free(&decFrame);
    if (scaledFrame)
      av_frame_free(&scaledFrame);
    if (pkt)
      av_packet_free(&pkt);
    if (encPkt)
      av_packet_free(&encPkt);

    if (ifmt)
      avformat_close_input(&ifmt); // leaves custom pb untouched (CUSTOM_IO)
    if (inAvio) {
      av_freep(&inAvio->buffer);
      avio_context_free(&inAvio);
    }
    if (ofmt) {
      if (fileOut && ofmt->pb)
        avio_closep(&ofmt->pb);
      avformat_free_context(ofmt);
    }
    if (!tempPath.empty())
      unlink(tempPath.c_str());
  }
};

} // namespace

TranscodeResult RunTranscode(const uint8_t *inData, size_t inSize, const std::string &inPath,
                             bool useFile, const std::string &outPath,
                             const TranscodeOptions &opts) {
  Ctx c;
  TranscodeResult result;
  int ret = 0;

  // --- open input -----------------------------------------------------------
  if (!useFile) {
    c.rb.data = inData;
    c.rb.size = inSize;
    c.rb.pos = 0;
    auto *buf = static_cast<unsigned char *>(av_malloc(kAvioBufferSize));
    if (!buf) {
      result.error = makeError("INPUT", "could not allocate input IO buffer");
      return result;
    }
    c.inAvio = avio_alloc_context(buf, kAvioBufferSize, 0, &c.rb, &ReadBuffer::read, nullptr,
                                  &ReadBuffer::seek);
    if (!c.inAvio) {
      av_free(buf);
      result.error = makeError("INPUT", "could not allocate input IO context");
      return result;
    }
    c.ifmt = avformat_alloc_context();
    if (!c.ifmt) {
      result.error = makeError("INPUT", "could not allocate input format context");
      return result;
    }
    c.ifmt->pb = c.inAvio;
    c.ifmt->flags |= AVFMT_FLAG_CUSTOM_IO;
  }

  ret = avformat_open_input(&c.ifmt, useFile ? inPath.c_str() : nullptr, nullptr, nullptr);
  if (ret < 0) {
    result.error = avError("INPUT", "could not open input", ret);
    return result;
  }

  ret = avformat_find_stream_info(c.ifmt, nullptr);
  if (ret < 0) {
    result.error = avError("INPUT", "could not read stream info", ret);
    return result;
  }

  int vIdx = av_find_best_stream(c.ifmt, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
  if (vIdx < 0) {
    result.error = makeError("UNSUPPORTED", "no video stream found in input");
    return result;
  }
  AVStream *vin = c.ifmt->streams[vIdx];
  int aIdx = av_find_best_stream(c.ifmt, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);

  // --- video decoder --------------------------------------------------------
  const AVCodec *vdecCodec = avcodec_find_decoder(vin->codecpar->codec_id);
  if (!vdecCodec) {
    result.error = makeError("UNSUPPORTED", "no decoder for input video codec");
    return result;
  }
  c.vdec = avcodec_alloc_context3(vdecCodec);
  if (!c.vdec) {
    result.error = makeError("DECODE", "could not allocate video decoder");
    return result;
  }
  avcodec_parameters_to_context(c.vdec, vin->codecpar);
  c.vdec->pkt_timebase = vin->time_base;
  ret = avcodec_open2(c.vdec, vdecCodec, nullptr);
  if (ret < 0) {
    result.error = avError("DECODE", "could not open video decoder", ret);
    return result;
  }

  int inW = c.vdec->width;
  int inH = c.vdec->height;
  if (inW <= 0 || inH <= 0) {
    result.error = makeError("INPUT", "input video has invalid dimensions");
    return result;
  }
  // scale down to fit within the maxWidth/maxHeight box (whichever caps bind),
  // preserving aspect ratio; never upscale.
  double scale = 1.0;
  if (opts.maxHeight > 0)
    scale = std::min(scale, static_cast<double>(opts.maxHeight) / inH);
  if (opts.maxWidth > 0)
    scale = std::min(scale, static_cast<double>(opts.maxWidth) / inW);
  int outW = static_cast<int>(std::lround(inW * scale));
  int outH = static_cast<int>(std::lround(inH * scale));
  outW &= ~1;
  outH &= ~1;
  if (outW < 2)
    outW = 2;
  if (outH < 2)
    outH = 2;

  // --- output format context ------------------------------------------------
  // The MP4 +faststart pass relocates the moov atom by reopening the output URL,
  // which is impossible for a custom in-memory AVIO. So always write to a real
  // file — a temp file in buffer mode — and read it back afterwards.
  const bool bufferMode = outPath.empty();
  std::string writePath = outPath;
  if (bufferMode) {
    const char *td = getenv("TMPDIR");
    std::string dir = (td && *td) ? td : "/tmp";
    if (!dir.empty() && dir.back() == '/')
      dir.pop_back();
    std::string tmpl = dir + "/ffmpeg-native-XXXXXX";
    std::vector<char> tbuf(tmpl.c_str(), tmpl.c_str() + tmpl.size() + 1);
    int fd = mkstemp(tbuf.data());
    if (fd < 0) {
      result.error = makeError("OUTPUT", "could not create temp output file");
      return result;
    }
    close(fd);
    c.tempPath.assign(tbuf.data());
    writePath = c.tempPath;
  }

  ret = avformat_alloc_output_context2(&c.ofmt, nullptr, "mp4", writePath.c_str());
  if (ret < 0 || !c.ofmt) {
    result.error = avError("OUTPUT", "could not create mp4 output", ret);
    return result;
  }
  ret = avio_open(&c.ofmt->pb, writePath.c_str(), AVIO_FLAG_WRITE);
  if (ret < 0) {
    result.error = avError("OUTPUT", "could not open output file", ret);
    return result;
  }
  c.fileOut = true;

  // --- video encoder (H.264 via OpenH264) ----------------------------------
  const AVCodec *vencCodec = avcodec_find_encoder_by_name("libopenh264");
  if (!vencCodec)
    vencCodec = avcodec_find_encoder(AV_CODEC_ID_H264);
  if (!vencCodec) {
    result.error = makeError("UNSUPPORTED", "no H.264 encoder available");
    return result;
  }
  AVStream *vout = avformat_new_stream(c.ofmt, nullptr);
  if (!vout) {
    result.error = makeError("OUTPUT", "could not create output video stream");
    return result;
  }
  c.venc = avcodec_alloc_context3(vencCodec);
  if (!c.venc) {
    result.error = makeError("ENCODE", "could not allocate video encoder");
    return result;
  }
  c.venc->width = outW;
  c.venc->height = outH;
  c.venc->pix_fmt = AV_PIX_FMT_YUV420P;
  c.venc->sample_aspect_ratio = c.vdec->sample_aspect_ratio;

  AVRational fr = vin->avg_frame_rate.num ? vin->avg_frame_rate
                  : vin->r_frame_rate.num ? vin->r_frame_rate
                                          : AVRational{30, 1};
  c.venc->framerate = fr;
  c.venc->time_base = av_inv_q(fr);
  c.venc->gop_size = 250;
  c.venc->max_b_frames = 0; // OpenH264 does not emit B-frames

  // bitrate target: caller-provided, else derived from output resolution and
  // frame rate (~0.08 bits per pixel per frame), clamped to a sane range.
  int64_t bitrate = opts.videoBitrate;
  if (bitrate <= 0) {
    double fps = av_q2d(fr);
    if (fps <= 0 || fps > 120)
      fps = 30.0;
    bitrate = static_cast<int64_t>(static_cast<double>(outW) * outH * fps * 0.08);
    if (bitrate < 300000)
      bitrate = 300000;
    if (bitrate > 8000000)
      bitrate = 8000000;
  }
  c.venc->bit_rate = bitrate;
  if (c.ofmt->oformat->flags & AVFMT_GLOBALHEADER)
    c.venc->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

  // OpenH264 rate control: quality-oriented VBR around the target bitrate.
  av_opt_set(c.venc->priv_data, "rc_mode", "quality", 0);
  av_opt_set(c.venc->priv_data, "profile", "high", 0);

  ret = avcodec_open2(c.venc, vencCodec, nullptr);
  if (ret < 0) {
    result.error = avError("ENCODE", "could not open H.264 encoder", ret);
    return result;
  }
  avcodec_parameters_from_context(vout->codecpar, c.venc);
  vout->time_base = c.venc->time_base;

  // --- scaler + reusable frames --------------------------------------------
  c.decFrame = av_frame_alloc();
  c.scaledFrame = av_frame_alloc();
  c.pkt = av_packet_alloc();
  c.encPkt = av_packet_alloc();
  if (!c.decFrame || !c.scaledFrame || !c.pkt || !c.encPkt) {
    result.error = makeError("ENCODE", "could not allocate working frames");
    return result;
  }
  c.scaledFrame->format = AV_PIX_FMT_YUV420P;
  c.scaledFrame->width = outW;
  c.scaledFrame->height = outH;
  ret = av_frame_get_buffer(c.scaledFrame, 32);
  if (ret < 0) {
    result.error = avError("ENCODE", "could not allocate scaled frame buffer", ret);
    return result;
  }

  // --- optional audio decoder + AAC encoder --------------------------------
  AVStream *aout = nullptr;
  bool audioEnabled = false;
  int64_t aPts = 0;
  if (aIdx >= 0) {
    AVStream *ain = c.ifmt->streams[aIdx];
    const AVCodec *adecCodec = avcodec_find_decoder(ain->codecpar->codec_id);
    const AVCodec *aencCodec = avcodec_find_encoder(AV_CODEC_ID_AAC);
    if (adecCodec && aencCodec) {
      c.adec = avcodec_alloc_context3(adecCodec);
      if (!c.adec) {
        result.error = makeError("DECODE", "could not allocate audio decoder");
        return result;
      }
      avcodec_parameters_to_context(c.adec, ain->codecpar);
      c.adec->pkt_timebase = ain->time_base;
      ret = avcodec_open2(c.adec, adecCodec, nullptr);
      if (ret < 0) {
        result.error = avError("DECODE", "could not open audio decoder", ret);
        return result;
      }
      if (c.adec->ch_layout.nb_channels <= 0)
        av_channel_layout_default(&c.adec->ch_layout, 2);

      aout = avformat_new_stream(c.ofmt, nullptr);
      if (!aout) {
        result.error = makeError("OUTPUT", "could not create output audio stream");
        return result;
      }
      c.aenc = avcodec_alloc_context3(aencCodec);
      if (!c.aenc) {
        result.error = makeError("ENCODE", "could not allocate audio encoder");
        return result;
      }
      c.aenc->sample_fmt = AV_SAMPLE_FMT_FLTP;
      c.aenc->sample_rate = c.adec->sample_rate > 0 ? c.adec->sample_rate : 48000;
      int outChannels = c.adec->ch_layout.nb_channels < 2 ? c.adec->ch_layout.nb_channels : 2;
      av_channel_layout_default(&c.aenc->ch_layout, outChannels);
      c.aenc->bit_rate = opts.audioBitrate;
      c.aenc->time_base = AVRational{1, c.aenc->sample_rate};
      if (c.ofmt->oformat->flags & AVFMT_GLOBALHEADER)
        c.aenc->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

      ret = avcodec_open2(c.aenc, aencCodec, nullptr);
      if (ret < 0) {
        result.error = avError("ENCODE", "could not open AAC encoder", ret);
        return result;
      }
      avcodec_parameters_from_context(aout->codecpar, c.aenc);
      aout->time_base = c.aenc->time_base;

      ret = swr_alloc_set_opts2(&c.swr, &c.aenc->ch_layout, c.aenc->sample_fmt,
                                c.aenc->sample_rate, &c.adec->ch_layout, c.adec->sample_fmt,
                                c.adec->sample_rate, 0, nullptr);
      if (ret < 0 || swr_init(c.swr) < 0) {
        result.error = makeError("ENCODE", "could not init audio resampler");
        return result;
      }
      c.fifo = av_audio_fifo_alloc(c.aenc->sample_fmt, c.aenc->ch_layout.nb_channels, 1);
      if (!c.fifo) {
        result.error = makeError("ENCODE", "could not allocate audio FIFO");
        return result;
      }
      audioEnabled = true;
    }
  }

  // --- write header ---------------------------------------------------------
  {
    AVDictionary *muxOpts = nullptr;
    if (opts.faststart)
      av_dict_set(&muxOpts, "movflags", "+faststart", 0);
    ret = avformat_write_header(c.ofmt, &muxOpts);
    av_dict_free(&muxOpts);
    if (ret < 0) {
      result.error = avError("OUTPUT", "could not write mp4 header", ret);
      return result;
    }
  }

  // --- encode helpers -------------------------------------------------------
  std::string err;
  int64_t lastVPts = AV_NOPTS_VALUE;

  auto drainEncoder = [&](AVCodecContext *enc, AVStream *st) -> bool {
    while (true) {
      int r = avcodec_receive_packet(enc, c.encPkt);
      if (r == AVERROR(EAGAIN) || r == AVERROR_EOF)
        return true;
      if (r < 0) {
        err = avError("ENCODE", "could not receive packet", r);
        return false;
      }
      c.encPkt->stream_index = st->index;
      av_packet_rescale_ts(c.encPkt, enc->time_base, st->time_base);
      r = av_interleaved_write_frame(c.ofmt, c.encPkt);
      av_packet_unref(c.encPkt);
      if (r < 0) {
        err = avError("OUTPUT", "could not write frame", r);
        return false;
      }
    }
  };

  auto encodeVideoFrame = [&](AVFrame *frame) -> bool {
    int r = avcodec_send_frame(c.venc, frame);
    if (r < 0) {
      err = avError("ENCODE", "could not send video frame", r);
      return false;
    }
    return drainEncoder(c.venc, vout);
  };

  auto processVideoPacket = [&](AVPacket *p) -> bool {
    int r = avcodec_send_packet(c.vdec, p);
    if (r < 0) {
      err = avError("DECODE", "could not send video packet", r);
      return false;
    }
    while (true) {
      r = avcodec_receive_frame(c.vdec, c.decFrame);
      if (r == AVERROR(EAGAIN) || r == AVERROR_EOF)
        break;
      if (r < 0) {
        err = avError("DECODE", "could not decode video frame", r);
        return false;
      }
      if (!c.sws) {
        c.sws = sws_getContext(c.decFrame->width, c.decFrame->height,
                               static_cast<AVPixelFormat>(c.decFrame->format), outW, outH,
                               AV_PIX_FMT_YUV420P, SWS_BILINEAR, nullptr, nullptr, nullptr);
        if (!c.sws) {
          av_frame_unref(c.decFrame);
          err = makeError("ENCODE", "could not initialize scaler");
          return false;
        }
      }
      if (av_frame_make_writable(c.scaledFrame) < 0) {
        av_frame_unref(c.decFrame);
        err = makeError("ENCODE", "could not make scaled frame writable");
        return false;
      }
      sws_scale(c.sws, c.decFrame->data, c.decFrame->linesize, 0, c.decFrame->height,
                c.scaledFrame->data, c.scaledFrame->linesize);

      int64_t ts = c.decFrame->best_effort_timestamp;
      if (ts == AV_NOPTS_VALUE)
        ts = c.decFrame->pts;
      int64_t pts =
          ts == AV_NOPTS_VALUE ? (lastVPts == AV_NOPTS_VALUE ? 0 : lastVPts + 1)
                               : av_rescale_q(ts, vin->time_base, c.venc->time_base);
      if (lastVPts != AV_NOPTS_VALUE && pts <= lastVPts)
        pts = lastVPts + 1;
      lastVPts = pts;
      c.scaledFrame->pts = pts;
      c.scaledFrame->pict_type = AV_PICTURE_TYPE_NONE;
      av_frame_unref(c.decFrame);

      if (!encodeVideoFrame(c.scaledFrame))
        return false;
    }
    return true;
  };

  auto drainFifo = [&](bool flush) -> bool {
    int frameSize = c.aenc->frame_size > 0 ? c.aenc->frame_size : 1024;
    while (av_audio_fifo_size(c.fifo) >= frameSize ||
           (flush && av_audio_fifo_size(c.fifo) > 0)) {
      int n = av_audio_fifo_size(c.fifo);
      if (n > frameSize)
        n = frameSize;
      AVFrame *af = av_frame_alloc();
      if (!af) {
        err = makeError("ENCODE", "could not allocate audio frame");
        return false;
      }
      af->nb_samples = n;
      af->format = c.aenc->sample_fmt;
      av_channel_layout_copy(&af->ch_layout, &c.aenc->ch_layout);
      af->sample_rate = c.aenc->sample_rate;
      if (av_frame_get_buffer(af, 0) < 0) {
        av_frame_free(&af);
        err = makeError("ENCODE", "could not allocate audio frame");
        return false;
      }
      av_audio_fifo_read(c.fifo, reinterpret_cast<void **>(af->data), n);
      af->pts = aPts;
      aPts += n;
      int r = avcodec_send_frame(c.aenc, af);
      av_frame_free(&af);
      if (r < 0) {
        err = avError("ENCODE", "could not send audio frame", r);
        return false;
      }
      if (!drainEncoder(c.aenc, aout))
        return false;
    }
    return true;
  };

  auto processAudioPacket = [&](AVPacket *p) -> bool {
    int r = avcodec_send_packet(c.adec, p);
    if (r < 0) {
      err = avError("DECODE", "could not send audio packet", r);
      return false;
    }
    while (true) {
      r = avcodec_receive_frame(c.adec, c.decFrame);
      if (r == AVERROR(EAGAIN) || r == AVERROR_EOF)
        break;
      if (r < 0) {
        err = avError("DECODE", "could not decode audio frame", r);
        return false;
      }
      int outCount = static_cast<int>(av_rescale_rnd(
          swr_get_delay(c.swr, c.adec->sample_rate) + c.decFrame->nb_samples,
          c.aenc->sample_rate, c.adec->sample_rate, AV_ROUND_UP));
      uint8_t **conv = nullptr;
      if (av_samples_alloc_array_and_samples(&conv, nullptr, c.aenc->ch_layout.nb_channels,
                                             outCount, c.aenc->sample_fmt, 0) < 0) {
        av_frame_unref(c.decFrame);
        err = makeError("ENCODE", "could not allocate resample buffer");
        return false;
      }
      int got = swr_convert(c.swr, conv, outCount,
                            const_cast<const uint8_t **>(c.decFrame->extended_data),
                            c.decFrame->nb_samples);
      av_frame_unref(c.decFrame);
      if (got > 0)
        av_audio_fifo_write(c.fifo, reinterpret_cast<void **>(conv), got);
      if (conv) {
        av_freep(&conv[0]);
        av_freep(&conv);
      }
      if (got < 0) {
        err = avError("DECODE", "could not resample audio", got);
        return false;
      }
      if (!drainFifo(false))
        return false;
    }
    return true;
  };

  // --- main demux loop ------------------------------------------------------
  while ((ret = av_read_frame(c.ifmt, c.pkt)) >= 0) {
    bool ok = true;
    if (c.pkt->stream_index == vIdx)
      ok = processVideoPacket(c.pkt);
    else if (audioEnabled && c.pkt->stream_index == aIdx)
      ok = processAudioPacket(c.pkt);
    av_packet_unref(c.pkt);
    if (!ok) {
      result.error = err;
      return result;
    }
  }
  if (ret != AVERROR_EOF && ret < 0) {
    result.error = avError("INPUT", "could not read input packet", ret);
    return result;
  }

  // --- flush video ----------------------------------------------------------
  if (!processVideoPacket(nullptr) || !encodeVideoFrame(nullptr)) {
    result.error = err;
    return result;
  }
  // --- flush audio ----------------------------------------------------------
  if (audioEnabled) {
    if (!processAudioPacket(nullptr)) {
      result.error = err;
      return result;
    }
    // drain the resampler's buffered delay into the FIFO so the audio tail is
    // not truncated (which would shorten audio relative to video).
    while (true) {
      int delay = static_cast<int>(swr_get_delay(c.swr, c.aenc->sample_rate));
      if (delay <= 0)
        break;
      uint8_t **conv = nullptr;
      if (av_samples_alloc_array_and_samples(&conv, nullptr, c.aenc->ch_layout.nb_channels, delay,
                                             c.aenc->sample_fmt, 0) < 0) {
        result.error = makeError("ENCODE", "could not allocate resample flush buffer");
        return result;
      }
      int got = swr_convert(c.swr, conv, delay, nullptr, 0);
      if (got > 0)
        av_audio_fifo_write(c.fifo, reinterpret_cast<void **>(conv), got);
      if (conv) {
        av_freep(&conv[0]);
        av_freep(&conv);
      }
      if (got <= 0)
        break;
    }
    if (!drainFifo(true)) {
      result.error = err;
      return result;
    }
    int r = avcodec_send_frame(c.aenc, nullptr);
    if (r < 0) {
      result.error = avError("ENCODE", "could not flush audio encoder", r);
      return result;
    }
    if (!drainEncoder(c.aenc, aout)) {
      result.error = err;
      return result;
    }
  }

  // --- finalize -------------------------------------------------------------
  ret = av_write_trailer(c.ofmt);
  if (ret < 0) {
    result.error = avError("OUTPUT", "could not finalize mp4", ret);
    return result;
  }

  // close the output to flush all bytes before reading the buffer back
  avio_closep(&c.ofmt->pb);
  c.fileOut = false;

  if (bufferMode) {
    FILE *f = fopen(c.tempPath.c_str(), "rb");
    if (!f) {
      result.error = makeError("OUTPUT", "could not read transcoded output");
      return result;
    }
    if (fseek(f, 0, SEEK_END) == 0) {
      long sz = ftell(f);
      rewind(f);
      if (sz > 0) {
        result.output.resize(static_cast<size_t>(sz));
        size_t rd = fread(result.output.data(), 1, static_cast<size_t>(sz), f);
        result.output.resize(rd);
      }
    }
    fclose(f);
  }
  return result;
}
