# gemma4-igpu-lab

Gemma 4 E2B on Intel iGPU setup notes, benchmarks, and a modern local web app for comparing `llama.cpp + Vulkan` and `Ollama`.

## Contents

- `app/`
  Next.js web app with a local dashboard for switching between `llama.cpp + Vulkan` and `Ollama`, sending prompts, and comparing live timing metrics.
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
- The web app is tuned for local `Gemma 4 E2B` runtime comparison on this PC.

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

### 3. Pick a runtime and click `Start`

The web app is prefilled for this machine's current setup:

- `llama.cpp + Vulkan`
  - `C:\Prj\Work\src\llama.cpp\build-mingw-vulkan\bin\llama-server.exe`
  - `C:\Prj\Work\models\gemma4-e2b\gemma-4-E2B-it-Q8_0.gguf`
  - `Vulkan0`
  - `--reasoning off`
  - `--reasoning-format none`
- `Ollama`
  - `C:\Users\makim\AppData\Local\Programs\Ollama\ollama.exe`
  - `gemma4e2b-q8-local:latest`

The app can reuse an already-running backend or start a tracked local process when needed.

### 4. Use a quick prompt

- `Write one short sentence about RAM.`
- `Explain RAM in exactly three short bullet points.`
- `Give three short tips for making local LLM inference feel faster on a low-end GPU.`

### 5. Watch the metrics and compare

The dashboard highlights the speed feel directly in the browser:

- `First Token`
- `Prompt tok/s`
- `Gen tok/s`
- `Total`
- latest result per runtime in the comparison card

## E2E Test

The repository includes a real browser E2E smoke test with Playwright. It opens the dashboard, runs a real chat on `llama.cpp + Vulkan`, switches to `Ollama`, runs another real chat, and verifies that timing metrics and comparison cards are shown.

### 1. Install the Playwright browser

```powershell
cd C:\Prj\gemma4-igpu-lab
npx playwright install chromium
```

### 2. Run the E2E suite

```powershell
npm run test:e2e
```

Notes:

- The E2E test is intentionally real, not mocked. It uses the local `llama.cpp + Vulkan` and `Ollama` setup from this machine.
- It can take a few minutes because the test waits for runtime startup and full streamed responses.
- HTML reports are written to `playwright-report/` when the suite finishes.
