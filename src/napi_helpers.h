#pragma once

#include <atomic>
#include <memory>
#include <napi.h>

// ---------------------------------------------------------------------------
// Per-environment alive flag for worker thread safety
// ---------------------------------------------------------------------------
// When a Node.js worker thread is terminated (worker.terminate()), the V8
// isolate tears down while libuv async completions may still fire. The base
// AsyncWorker::OnWorkComplete opens a HandleScope, which crashes on a dying
// isolate. This flag, plus a probe, lets workers bail out before touching V8.

struct AddonData {
  std::shared_ptr<std::atomic<bool>> envAlive = std::make_shared<std::atomic<bool>>(true);
};

inline std::shared_ptr<std::atomic<bool>> GetEnvAlive(Napi::Env env) {
  auto *data = env.GetInstanceData<AddonData>();
  return data ? data->envAlive : nullptr;
}

// ---------------------------------------------------------------------------
// SafeAsyncWorker — guards OnWorkComplete against env teardown
// ---------------------------------------------------------------------------
// All async workers MUST inherit from this instead of Napi::AsyncWorker to be
// safe in worker threads that may be terminated at any time.

class SafeAsyncWorker : public Napi::AsyncWorker {
public:
  void OnWorkComplete(Napi::Env env, napi_status status) override {
    // On the bail-out paths we must still free the worker and its async_work
    // handle (normally done by the base OnWorkComplete via Destroy()). Destroy()
    // only does `delete this` + napi_delete_async_work — no V8/HandleScope — so
    // it is safe even while the isolate is tearing down.

    // cleanup hook already fired — env is being torn down
    if (envAlive_ && !envAlive_->load()) {
      Destroy();
      return;
    }

    // probe whether V8 is still accessible (raw C call, no throw on failure)
    napi_handle_scope scope = nullptr;
    if (napi_open_handle_scope(env, &scope) != napi_ok) {
      Destroy();
      return;
    }
    napi_close_handle_scope(env, scope);

    try {
      Napi::AsyncWorker::OnWorkComplete(env, status);
    } catch (const Napi::Error &) {
      // env tore down between our probe and the base class call — swallow
    }
  }

protected:
  std::shared_ptr<std::atomic<bool>> envAlive_;

  explicit SafeAsyncWorker(Napi::Env env)
      : Napi::AsyncWorker(env), envAlive_(GetEnvAlive(env)) {}
};
