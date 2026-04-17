# gemma4-igpu-lab

Gemma 4 E2B on Intel iGPU setup notes, benchmarks, and a modern local web app for feeling `llama.cpp + Vulkan` speed.

## Contents

- `app/`
  Next.js web app with a local dashboard for starting `llama-server`, sending prompts, and watching live timing metrics.
- `components/`
  `shadcn/ui`-style interface components and the main speed lab screen.
- `docs/Gemma4-E2B-iGPU-Setup-Benchmark-Report.md`
  Detailed setup and benchmark report for running Gemma 4 E2B on Windows with Intel iGPU.
- `scripts/run-llama-process.ps1`
  Helper script used during the original llama.cpp benchmarking work.
- `patches/llama-cpp-mingw-vulkan.patch`
  Local patch used to make the tested llama.cpp MinGW + Vulkan build work on this machine.
- `logs/`
  Captured runtime logs and benchmark artifacts from the experiment.

## Notes

- Large third-party artifacts such as model files, full `llama.cpp` source trees, build outputs, and Python virtual environments are intentionally excluded from the repository.
- The main reference document is the report under `docs/`.
- The web app is tuned specifically for `llama.cpp + Vulkan`, not for generic multi-runtime comparison.

## Quick Start: Web App

### 1. Install dependencies

```powershell
cd C:\Prj\gemma4-igpu-lab
npm install
```

### 2. Start the dev server

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

### 3. Click `Start Server`

The web app is prefilled for this machine's current setup:

- `C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin\llama-server.exe`
- `C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf`
- `Vulkan0`
- `--reasoning off`
- `--reasoning-format none`

It starts `llama-server` itself, waits for `/health`, and then the dashboard is ready to use.

### 4. Use a quick prompt

- `Write one short sentence about RAM.`
- `Explain RAM in exactly three short bullet points.`
- `Give three short tips for making local LLM inference feel faster on a low-end GPU.`

### 5. Watch the metrics

The dashboard highlights the speed feel directly in the browser:

- `First Token`
- `Prompt tok/s`
- `Gen tok/s`
- `Total`
