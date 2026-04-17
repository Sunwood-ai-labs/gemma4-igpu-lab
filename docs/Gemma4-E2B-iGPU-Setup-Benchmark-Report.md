# Gemma 4 E2B on Intel iGPU (Windows) Setup and Benchmark Report

- Report date: 2026-04-17
- Authoring context: local validation on Windows 11 + Intel iGPU
- Goal: make `Gemma 4 E2B` usable on a PC without discrete GPU, and document a reproducible path for another Windows PC

## 1. Executive Summary

This report documents the setup and benchmark work performed to run `Gemma 4 E2B` on a Windows laptop with only an Intel integrated GPU (`iGPU`).

Three runtime paths were investigated:

1. `llama.cpp + Vulkan`
2. `Ollama + Vulkan`
3. `OpenVINO`

Outcome:

- `llama.cpp + Vulkan` was the fastest stable path in this environment.
- `Ollama + Vulkan` was very close in speed and much easier to operate day to day.
- `OpenVINO` could be installed, and the Intel GPU was visible, but the current `Gemma 4` path did not reach a working benchmark in this environment due to model/runtime compatibility issues.

Recommendation:

- If speed is the top priority, use `llama.cpp + Vulkan`.
- If simplicity is the top priority, use `Ollama + Vulkan`.
- Treat `OpenVINO` for `Gemma 4` as experimental until official support is clearer.

## 2. Test Environment

### 2.1 Hardware

- Manufacturer: `Micro-Star International Co., Ltd.`
- Model: `Modern 14 H D13MG`
- CPU: `Intel Core i7-13620H`
- iGPU: `Intel(R) UHD Graphics`
- GPU driver: `32.0.101.7082`
- RAM: `64 GB`

### 2.2 OS

- OS: `Microsoft Windows 11 Home`
- Version: `10.0.26200`
- Build: `26200`
- Architecture: `64-bit`

### 2.3 Software Versions Used

- `Ollama 0.20.7`
- `Python 3.12.10`
- `CMake 4.3.1`
- `Vulkan SDK 1.4.341.1`
- `WinLibs (POSIX threads, UCRT runtime) 15.2.0-14.0.0-r7`
- `llama.cpp` source commit: `9db77a020c97ac3b13b7c1bf4e0c5787001533e7`
- `openvino-genai 2026.1.0.0`

### 2.4 Vulkan Validation Result

The Intel iGPU was confirmed visible to Vulkan:

- `deviceType = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU`
- `deviceName = Intel(R) UHD Graphics`
- `apiVersion = 1.4.323`
- `driverVersion = 101.7082`

## 3. What Was Tested

### 3.1 Runtimes

1. `llama.cpp + Vulkan`
2. `Ollama + Vulkan`
3. `OpenVINO`

### 3.2 Model Variants

For fair comparison, the main benchmark used the same `GGUF` model file:

- `gemma-4-E2B-it-Q8_0.gguf`
- Size: `4,967,494,592 bytes`

An additional practical reference benchmark was also taken with the official Ollama model:

- `gemma4:e2b-it-q4_K_M`

### 3.3 Benchmark Rule

The strict comparison benchmark used:

- Prompt: `Write one short sentence about RAM.`
- `max new tokens = 64`
- `temperature = 0`
- `seed = 123`
- `ignore_eos = true`

This forces each runtime to continue generating to 64 tokens and makes throughput comparison much easier.

## 4. Reproducible Setup for Another Windows PC

This section is written so the same work can be repeated on a different Windows PC with Intel iGPU.

### 4.1 Recommended Minimum Requirements

- Windows 11
- Intel iGPU with current Vulkan-capable driver
- At least `32 GB RAM`
- Preferably `64 GB RAM`
- At least `30 GB` free disk space for tools, source, and model files

### 4.2 Create a Working Directory

Example:

```powershell
New-Item -ItemType Directory -Force -Path C:\Prj\Work
Set-Location C:\Prj\Work
```

### 4.3 Install Required Tools

Install the same toolchain used in this validation:

```powershell
winget install --id Ollama.Ollama -e
winget install --id Python.Python.3.12 -e
winget install --id Kitware.CMake -e
winget install --id KhronosGroup.VulkanSDK -e
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e
```

Optional but recommended:

```powershell
winget install --id Git.Git -e
winget install --id Ninja-build.Ninja -e
```

After installation, verify:

```powershell
ollama --version
python --version
cmake --version
vulkaninfoSDK.exe --summary
```

If `vulkaninfoSDK.exe` is not on `PATH`, run it from the SDK install path instead.

### 4.4 Verify Vulkan Can See the Intel iGPU

Run:

```powershell
vulkaninfoSDK.exe --summary
```

You want to see output similar to:

```text
deviceType = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU
deviceName = Intel(R) UHD Graphics
```

If the Intel iGPU does not appear here, fix graphics driver issues before going further.

## 5. Model Preparation

### 5.1 Download a GGUF Build of Gemma 4 E2B

The direct `Ollama` blob for `gemma4:e2b-it-q4_K_M` was not directly loadable by `llama.cpp` in this test, so a standalone GGUF model was downloaded instead.

Recommended source used in this validation:

- Hugging Face repo: `ggml-org/gemma-4-E2B-it-GGUF`
- File used: `gemma-4-E2B-it-Q8_0.gguf`

Example download location:

```powershell
New-Item -ItemType Directory -Force -Path C:\Prj\Work\models\gemma4-e2b
```

Download the file into:

```text
C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf
```

### 5.2 Optional: Pull the Official Ollama Build

This is useful for a "works out of the box" reference path:

```powershell
ollama pull gemma4:e2b-it-q4_K_M
```

## 6. Ollama + Vulkan Setup

### 6.1 Why This Path

`Ollama` is the simplest path for daily use. It hides most low-level runtime management and is easy to script or connect to apps.

### 6.2 Start a Dedicated Vulkan-Enabled Ollama Server

In this validation, a dedicated server was launched on a non-default port so it would not interfere with the default background service.

```powershell
$env:OLLAMA_HOST='127.0.0.1:11435'
$env:OLLAMA_VULKAN='1'
$env:GGML_VK_VISIBLE_DEVICES='0'
ollama serve
```

Then verify:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:11435/api/version
```

The server log should mention Vulkan and the Intel GPU.

### 6.3 Build a Local Ollama Model from the Same Q8 GGUF

Create a `Modelfile`:

```text
FROM C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf
TEMPLATE {{ .Prompt }}
RENDERER gemma4
PARSER gemma4
PARAMETER temperature 0
```

Then create the model:

```powershell
$env:OLLAMA_HOST='127.0.0.1:11435'
ollama create gemma4e2b-q8-local -f C:\Prj\Work\Modelfile.gemma4e2b-q8-local
```

List models:

```powershell
$env:OLLAMA_HOST='127.0.0.1:11435'
ollama list
```

### 6.4 Run a Simple Test

```powershell
$env:OLLAMA_HOST='127.0.0.1:11435'
ollama run gemma4e2b-q8-local
```

## 7. llama.cpp + Vulkan Setup

### 7.1 Why This Path

This path gave the best measured throughput in this validation and provides fine-grained control of device offload.

### 7.2 Clone Source

```powershell
New-Item -ItemType Directory -Force -Path C:\Prj\Work\src | Out-Null
git clone https://github.com/ggml-org/llama.cpp C:\Prj\Work\src\llama.cpp
```

### 7.3 Toolchain Notes

This validation used:

- `CMake`
- `Ninja`
- `WinLibs` GCC/G++
- `Vulkan SDK`

Example binary path for WinLibs:

```text
C:\Users\<USERNAME>\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin
```

### 7.4 Required Build Fixes on This Windows + MinGW Setup

Two local source fixes were needed in this environment:

1. `vendor/cpp-httplib/httplib.cpp`
   Use `CreateFileW` on `__MINGW32__` instead of `CreateFile2`.
2. `ggml/src/ggml-vulkan/ggml-vulkan.cpp`
   On `_WIN32`, include `<spirv-headers/spirv.hpp>`.

If your environment is different, these exact fixes may not be necessary. They were required on this tested machine.

### 7.5 Configure the Build

Example:

```powershell
$env:PATH='C:\Program Files\CMake\bin;C:\Program Files\Git\cmd;' + $env:PATH
$env:PATH='C:\Users\<USERNAME>\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;' + $env:PATH
$env:PATH='C:\VulkanSDK\1.4.341.1\Bin;' + $env:PATH

where.exe ninja
where.exe gcc
where.exe g++

cmake -S C:\Prj\Work\src\llama.cpp -B C:\Prj\Work\src\llama.cpp\build-mingw-vulkan -G Ninja `
  -DGGML_VULKAN=ON `
  -DCMAKE_C_COMPILER=gcc `
  -DCMAKE_CXX_COMPILER=g++ `
  -DCMAKE_C_FLAGS='-D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00' `
  -DCMAKE_CXX_FLAGS='-D_WIN32_WINNT=0x0A00 -DWINVER=0x0A00'
```

Build:

```powershell
cmake --build C:\Prj\Work\src\llama.cpp\build-mingw-vulkan --config Release -j
```

Expected binaries:

- `llama-cli.exe`
- `llama-server.exe`
- `llama-bench.exe`

### 7.6 Confirm llama.cpp Can See the Intel iGPU

```powershell
& 'C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin\llama-cli.exe' --list-devices
```

You want to see `Vulkan0` mapped to the Intel iGPU.

### 7.7 Run the Model Once

```powershell
$env:PATH='C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin;C:\Users\<USERNAME>\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;C:\VulkanSDK\1.4.341.1\Bin;' + $env:PATH

& 'C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin\llama-cli.exe' `
  -m C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf `
  -dev Vulkan0 `
  -ngl all `
  -c 4096 `
  -n 64 `
  -p 'Write one short sentence about RAM.' `
  --temp 0 `
  --seed 123 `
  --single-turn `
  --simple-io `
  --no-display-prompt `
  --no-warmup
```

In this validation, stderr confirmed that model and KV buffers were actually offloaded to `Vulkan0 (Intel(R) UHD Graphics)`.

## 8. Optional Helper Script for Repeated Runs

For repeated testing, a helper PowerShell wrapper was created to:

- inject extra `PATH` entries
- redirect stdout and stderr to log files
- enforce timeouts
- keep command lines reproducible

Example invocation pattern:

```powershell
& 'C:\Prj\Work\run-llama-process.ps1' `
  -Exe 'C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin\llama-cli.exe' `
  -Arguments @(
    '-m','C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf',
    '-dev','Vulkan0',
    '-ngl','all',
    '-c','4096',
    '-n','64',
    '-p','Write one short sentence about RAM.',
    '--temp','0',
    '--seed','123',
    '--single-turn',
    '--simple-io',
    '--no-display-prompt',
    '--no-warmup'
  ) `
  -TimeoutSeconds 600 `
  -StdoutLog 'C:\Prj\Work\logs\llama-cli-q8.stdout.log' `
  -StderrLog 'C:\Prj\Work\logs\llama-cli-q8.stderr.log' `
  -ExtraPath 'C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin;C:\Users\<USERNAME>\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;C:\VulkanSDK\1.4.341.1\Bin'
```

## 9. OpenVINO Setup Attempt

### 9.1 Why It Was Investigated

`OpenVINO` is attractive for Intel hardware because it can often make good use of Intel CPUs and GPUs.

### 9.2 Environment Setup Used

Create a virtual environment:

```powershell
& 'C:\Users\<USERNAME>\AppData\Local\Programs\Python\Python312\python.exe' -m venv C:\Prj\Work\tools\openvino-venv
& 'C:\Prj\Work\tools\openvino-venv\Scripts\python.exe' -m pip install --upgrade pip setuptools wheel
& 'C:\Prj\Work\tools\openvino-venv\Scripts\python.exe' -m pip install openvino-genai huggingface_hub
```

Verify available devices:

```powershell
@'
import openvino as ov
core = ov.Core()
print(core.available_devices)
for d in core.available_devices:
    print(d, core.get_property(d, 'FULL_DEVICE_NAME'))
'@ | & 'C:\Prj\Work\tools\openvino-venv\Scripts\python.exe' -
```

Observed result in this validation:

- `CPU`
- `GPU`
- `Intel(R) UHD Graphics (iGPU)`

### 9.3 Model Attempted

Downloaded model:

- `OpenArcBob/gemma-4-E2B-it-int4-OpenArc`

### 9.4 Result

The setup did not reach a valid benchmark because of runtime/model compatibility problems:

- `GPU` path failed with a type mismatch during compilation
- `LLMPipeline` path failed because the model exposed `5` inputs instead of the expected `3` or `4`
- `VLMPipeline` path reported: `Unsupported 'gemma4' VLM model type`

Conclusion:

- `OpenVINO` itself installed correctly
- the Intel iGPU was visible correctly
- but the tested `Gemma 4` model/runtime path was not benchmark-ready in this environment

## 10. Benchmark Methodology

### 10.1 Strict Comparison Benchmark

The main comparison used:

- same prompt
- same deterministic settings
- same `Q8_0` GGUF model
- same target of `64` generated tokens
- repeated runs after setup

Prompt:

```text
Write one short sentence about RAM.
```

Settings:

- `temperature = 0`
- `seed = 123`
- `num_predict = 64`
- `ignore_eos = true`

### 10.2 Notes About Fairness

- `llama.cpp + Vulkan` and `Ollama + Vulkan` were compared on the same local `Q8_0` GGUF.
- The additional `Ollama q4_K_M` benchmark is a practical reference, not a strict apples-to-apples comparison.
- First runs often include model load cost and should be read separately from warm runs.

## 11. Benchmark Results

### 11.1 Strict Comparison: Same Q8 GGUF

| Runtime | Model | Run count | Gen tok/s mean | Gen tok/s median | Min | Max | Total time median |
|---|---|---:|---:|---:|---:|---:|---:|
| `llama.cpp + Vulkan` | `gemma-4-E2B-it-Q8_0.gguf` | 6 | 9.297 | 9.215 | 9.08 | 9.81 | 7.173 s |
| `Ollama + Vulkan` | `gemma4e2b-q8-local` | 6 | 8.930 | 8.970 | 8.68 | 9.03 | 8.817 s |

### 11.2 Per-Run Results: llama.cpp + Vulkan

| Run | Prompt tokens | Prompt tok/s | Generated tokens | Gen tok/s | Total time |
|---:|---:|---:|---:|---:|---:|
| 1 | 8 | 29.97 | 64 | 9.08 | 7.439 s |
| 2 | 8 | 27.80 | 64 | 9.16 | 7.322 s |
| 3 | 8 | 36.21 | 64 | 9.23 | 7.167 s |
| 4 | 8 | 34.25 | 64 | 9.30 | 7.135 s |
| 5 | 8 | 31.32 | 64 | 9.81 | 6.798 s |
| 6 | 8 | 36.78 | 64 | 9.20 | 7.179 s |

### 11.3 Per-Run Results: Ollama + Vulkan with Local Q8 Model

| Run | Prompt tokens | Prompt tok/s | Generated tokens | Gen tok/s | Load time | Total time |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 24 | 177.99 | 64 | 9.03 | 1.562 s | 9.022 s |
| 2 | 24 | 136.89 | 64 | 8.98 | 1.090 s | 8.616 s |
| 3 | 24 | 113.77 | 64 | 8.68 | 1.226 s | 9.038 s |
| 4 | 24 | 150.95 | 64 | 8.94 | 0.830 s | 8.349 s |
| 5 | 24 | 126.00 | 64 | 8.96 | 1.265 s | 8.801 s |
| 6 | 24 | 155.02 | 64 | 8.99 | 1.353 s | 8.834 s |

### 11.4 Practical Reference: Ollama Official q4_K_M Model

Warm-run reference after the initial load-heavy pass:

| Run | Prompt tokens | Generated tokens | Gen tok/s | Load time | Total time |
|---:|---:|---:|---:|---:|---:|
| 2 | 23 | 64 | 8.11 | 0.884 s | 9.081 s |
| 3 | 23 | 64 | 9.39 | 1.002 s | 8.125 s |
| 4 | 23 | 64 | 9.28 | 0.900 s | 8.022 s |

Interpretation:

- The official `q4_K_M` Ollama build was in the same rough performance class.
- Throughput was not dramatically faster than local `Q8_0` in these runs.
- If convenience matters more than strict control, the official Ollama build is still a strong choice.

## 12. Final Recommendation

### 12.1 Best Raw Performance

Use `llama.cpp + Vulkan`.

Why:

- highest measured throughput in this environment
- reliable direct control over Vulkan device offload
- good visibility into logs and memory placement

### 12.2 Best Ease of Use

Use `Ollama + Vulkan`.

Why:

- much simpler operational model
- almost the same speed class as `llama.cpp`
- easier to integrate with local tools, scripts, and UIs

### 12.3 Not Yet Recommended Here

Do not choose `OpenVINO` first for `Gemma 4 E2B` on this exact path unless you specifically want to investigate compatibility issues.

## 13. Known Issues and Notes

### 13.1 Ollama Blob vs Standalone GGUF

The internal model blob used by `ollama pull gemma4:e2b-it-q4_K_M` was not directly loadable by the tested `llama.cpp` builds. For cross-runtime benchmarking, use a standalone GGUF model file.

### 13.2 First Run Is Often Much Slower

The first run may include:

- model loading
- Vulkan initialization
- cache creation
- warmup work

For real performance comparison, use warm runs or explicitly separate load time from generation time.

### 13.3 OpenVINO Status

This report should be read as:

- `OpenVINO works on this machine`
- `OpenVINO GPU is detected on this machine`
- `Gemma 4 on the tested OpenVINO path was not ready for benchmark`

These are not the same statement, and keeping them separate is important.

## 14. Suggested Next Steps for Another PC

If repeating this work on another machine, follow this order:

1. Install tools and verify Vulkan sees the Intel iGPU.
2. Start with `Ollama + Vulkan` to confirm the machine can actually run the model.
3. Move to `llama.cpp + Vulkan` if you want the fastest local path.
4. Only investigate `OpenVINO` after the first two paths are already working.

## 15. Short Reproduction Checklist

```text
[ ] Windows + Intel GPU driver updated
[ ] Vulkan SDK installed
[ ] vulkaninfo shows Intel integrated GPU
[ ] Ollama installed
[ ] Q8 GGUF downloaded
[ ] llama.cpp built with GGML_VULKAN=ON
[ ] llama.cpp sees Vulkan0
[ ] Ollama Vulkan server starts
[ ] Same prompt and seed used for benchmark
[ ] Warm runs recorded separately from first-load run
```

## 16. File/Artifact Paths Used in This Validation

- Working directory: `C:\Prj\Work`
- GGUF model: `C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf`
- llama.cpp source: `C:\Prj\Work\src\llama.cpp`
- llama.cpp build: `C:\Prj\Work\src\llama.cpp\build-mingw-vulkan`
- Helper script: `C:\Prj\Work\run-llama-process.ps1`
- Ollama Modelfile: `C:\Prj\Work\Modelfile.gemma4e2b-q8-local`
- OpenVINO venv: `C:\Prj\Work\tools\openvino-venv`

## 17. Bottom Line

On this Windows laptop with `Intel UHD Graphics` and `64 GB RAM`, `Gemma 4 E2B` is usable locally without a discrete GPU.

The most practical conclusion from the work is:

- `llama.cpp + Vulkan` is the best performance path
- `Ollama + Vulkan` is the best convenience path
- `OpenVINO` is promising in general for Intel hardware, but not yet the recommended first choice for this exact `Gemma 4` workflow
