#include <napi.h>

#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "napi_helpers.h"
#include "transcode.h"

// ---------------------------------------------------------------------------
// TranscodeWorker — runs the libav pipeline off the event loop
// ---------------------------------------------------------------------------

class TranscodeWorker : public SafeAsyncWorker {
public:
  // buffer input variant
  TranscodeWorker(Napi::Env env, std::vector<uint8_t> data, TranscodeOptions opts,
                  std::string outputPath)
      : SafeAsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)),
        bufferData_(std::move(data)), useFile_(false), opts_(std::move(opts)),
        outputPath_(std::move(outputPath)) {}

  // file path input variant
  TranscodeWorker(Napi::Env env, std::string path, TranscodeOptions opts, std::string outputPath)
      : SafeAsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)),
        inputPath_(std::move(path)), useFile_(true), opts_(std::move(opts)),
        outputPath_(std::move(outputPath)) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

protected:
  void Execute() override {
    TranscodeResult res =
        RunTranscode(bufferData_.data(), bufferData_.size(), inputPath_, useFile_, outputPath_,
                     opts_);
    if (!res.error.empty()) {
      SetError(res.error);
      return;
    }
    output_ = std::move(res.output);
  }

  void OnOK() override {
    if (outputPath_.empty()) {
      // move the bytes into a heap holder so the Buffer can adopt them without a
      // copy and free them when V8 garbage-collects the Buffer. The unique_ptr
      // frees the holder if Buffer::New throws; on success ownership is handed to
      // the finalizer via release().
      auto holder = std::make_unique<std::vector<uint8_t>>(std::move(output_));
      auto buffer = Napi::Buffer<uint8_t>::New(
          Env(), holder->data(), holder->size(),
          [](Napi::Env, uint8_t *, std::vector<uint8_t> *p) { delete p; }, holder.get());
      holder.release();
      deferred_.Resolve(buffer);
    } else {
      deferred_.Resolve(Env().Undefined());
    }
  }

  void OnError(const Napi::Error &error) override { deferred_.Reject(error.Value()); }

private:
  Napi::Promise::Deferred deferred_;
  std::vector<uint8_t> bufferData_;
  std::string inputPath_;
  bool useFile_;
  TranscodeOptions opts_;
  std::string outputPath_;
  std::vector<uint8_t> output_;
};

// ---------------------------------------------------------------------------
// JS API: transcode(input, options)
// ---------------------------------------------------------------------------

static Napi::Value Transcode(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected input (Buffer or string)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  TranscodeOptions opts;
  std::string outputPath;

  if (info.Length() >= 2 && info[1].IsObject()) {
    Napi::Object options = info[1].As<Napi::Object>();
    if (options.Has("maxHeight"))
      opts.maxHeight = options.Get("maxHeight").As<Napi::Number>().Int32Value();
    if (options.Has("maxWidth"))
      opts.maxWidth = options.Get("maxWidth").As<Napi::Number>().Int32Value();
    if (options.Has("videoBitrate"))
      opts.videoBitrate = options.Get("videoBitrate").As<Napi::Number>().Int64Value();
    if (options.Has("audioBitrate"))
      opts.audioBitrate = options.Get("audioBitrate").As<Napi::Number>().Int32Value();
    if (options.Has("faststart"))
      opts.faststart = options.Get("faststart").As<Napi::Boolean>().Value();
    if (options.Has("output"))
      outputPath = options.Get("output").As<Napi::String>().Utf8Value();
  }

  if (info[0].IsBuffer()) {
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    std::vector<uint8_t> data(buf.Data(), buf.Data() + buf.Length());
    auto *worker = new TranscodeWorker(env, std::move(data), std::move(opts), std::move(outputPath));
    worker->Queue();
    return worker->Promise();
  }

  if (info[0].IsString()) {
    auto path = info[0].As<Napi::String>().Utf8Value();
    auto *worker = new TranscodeWorker(env, std::move(path), std::move(opts), std::move(outputPath));
    worker->Queue();
    return worker->Promise();
  }

  Napi::TypeError::New(env, "Input must be a Buffer or file path string")
      .ThrowAsJavaScriptException();
  return env.Undefined();
}

// ---------------------------------------------------------------------------
// Module init
// ---------------------------------------------------------------------------

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  auto *addonData = new AddonData();
  // SetInstanceData installs a finalizer that deletes addonData on env teardown,
  // so the cleanup hook must NOT delete it again (double free). The hook only
  // flips the alive flag so any in-flight worker bails before touching V8.
  env.SetInstanceData(addonData);
  env.AddCleanupHook([addonData]() { addonData->envAlive->store(false); });

  exports.Set("transcode", Napi::Function::New(env, Transcode));
  return exports;
}

NODE_API_MODULE(ffmpeg, Init)
