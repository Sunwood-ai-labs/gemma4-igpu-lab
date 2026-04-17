# gemma4-igpu-lab

Gemma 4 E2B on Intel iGPU setup notes, scripts, logs, and benchmark artifacts.

## Contents

- `docs/Gemma4-E2B-iGPU-Setup-Benchmark-Report.md`
  Detailed setup and benchmark report for running Gemma 4 E2B on Windows with Intel iGPU.
- `scripts/run-llama-process.ps1`
  Helper script used to run llama.cpp commands with logs, timeout handling, and extra PATH entries.
- `ollama/Modelfile.gemma4e2b-q8-local`
  Ollama Modelfile used to register the local `Q8_0` GGUF build.
- `logs/`
  Raw logs captured during the experiment.
- `patches/llama-cpp-mingw-vulkan.patch`
  Local patch used to make the tested llama.cpp MinGW + Vulkan build work on this machine.

## Notes

- Large third-party artifacts such as model files, full `llama.cpp` source trees, build outputs, and Python virtual environments are intentionally excluded from the repository.
- The main entry point for reproducing the experiment is the report under `docs/`.
