{
  "targets": [
    {
      "target_name": "ffmpeg",
      "sources": [
        "src/ffmpeg_addon.cc",
        "src/transcode.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "deps/ffmpeg/include",
        "deps/openh264/include",
        "src"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "__STDC_CONSTANT_MACROS",
        "__STDC_LIMIT_MACROS",
        "__STDC_FORMAT_MACROS"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags": [
        "-O2",
        "-ffunction-sections",
        "-fdata-sections"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-fvisibility=hidden"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
              "DEAD_CODE_STRIPPING": "YES",
              "LLVM_LTO": "NO",
              "OTHER_CPLUSPLUSFLAGS": [
                "-O2",
                "-ffunction-sections",
                "-fdata-sections"
              ],
              "OTHER_LDFLAGS": [
                "<(module_root_dir)/deps/ffmpeg/lib/libavformat.a",
                "<(module_root_dir)/deps/ffmpeg/lib/libavcodec.a",
                "<(module_root_dir)/deps/ffmpeg/lib/libswscale.a",
                "<(module_root_dir)/deps/ffmpeg/lib/libswresample.a",
                "<(module_root_dir)/deps/ffmpeg/lib/libavutil.a",
                "<(module_root_dir)/deps/openh264/lib/libopenh264.a",
                "-lz",
                "-lbz2",
                "-liconv",
                "-Wl,-dead_strip",
                "-Wl,-S",
                "-framework CoreFoundation",
                "-framework CoreMedia",
                "-framework CoreVideo",
                "-framework Security",
                "-framework AudioToolbox",
                "-framework VideoToolbox"
              ]
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "libraries": [
              "-Wl,--start-group",
              "<(module_root_dir)/deps/ffmpeg/lib/libavformat.a",
              "<(module_root_dir)/deps/ffmpeg/lib/libavcodec.a",
              "<(module_root_dir)/deps/ffmpeg/lib/libswscale.a",
              "<(module_root_dir)/deps/ffmpeg/lib/libswresample.a",
              "<(module_root_dir)/deps/ffmpeg/lib/libavutil.a",
              "<(module_root_dir)/deps/openh264/lib/libopenh264.a",
              "-Wl,--end-group",
              "-lz",
              "-lm",
              "-lpthread",
              "-ldl",
              "-static-libstdc++",
              "-Wl,-Bsymbolic",
              "-Wl,--gc-sections",
              "-Wl,-S"
            ]
          }
        ],
        [
          "OS=='win'",
          {
            "defines": [
              "_HAS_EXCEPTIONS=1",
              "_CRT_SECURE_NO_WARNINGS"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "Optimization": 2,
                "RuntimeLibrary": 0,
                "AdditionalOptions": [
                  "/std:c++17"
                ]
              }
            },
            "libraries": [
              "<(module_root_dir)/deps/ffmpeg/lib/avformat.lib",
              "<(module_root_dir)/deps/ffmpeg/lib/avcodec.lib",
              "<(module_root_dir)/deps/ffmpeg/lib/swscale.lib",
              "<(module_root_dir)/deps/ffmpeg/lib/swresample.lib",
              "<(module_root_dir)/deps/ffmpeg/lib/avutil.lib",
              "<(module_root_dir)/deps/ffmpeg/lib/zlib.lib",
              "<(module_root_dir)/deps/openh264/lib/openh264.lib",
              "ws2_32.lib",
              "secur32.lib",
              "bcrypt.lib",
              "mfplat.lib",
              "mfuuid.lib",
              "strmiids.lib",
              "ole32.lib",
              "oleaut32.lib",
              "user32.lib",
              "gdi32.lib",
              "shlwapi.lib",
              "dxgi.lib",
              "d3d11.lib",
              "d3d12.lib",
              "legacy_stdio_definitions.lib"
            ]
          }
        ]
      ]
    }
  ]
}
