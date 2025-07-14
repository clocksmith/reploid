# Jetson Orin LLM Engine

**[Back to Main Project README](../README.md)** | **[View REPLOID Harness Project (`/x/`)](../x/README.md)**

---

This project provides a complete, high-performance toolkit for running and benchmarking quantized GGUF language models on an NVIDIA Jetson Orin with 64GB of unified RAM. It is designed for maximum throughput, detailed performance analysis, and ease of use through both an interactive command-line interface (CLI) and a simple web UI.

The architecture is built to be modular, allowing for easy testing of different models (Gemma, Llama, etc.) and configurations.

## Core Features

*   **Optimized for Jetson Orin:** Leverages the full power of the Orin's GPU for `llama-cpp-python` by offloading all possible layers.
*   **Interactive Chat CLI:** A powerful `run_chat_cli.py` script for conversations, with detailed performance metrics after each response.
*   **Web-Based UI:** An "offline-first" web interface powered by a Python back-end, allowing for easy model interaction without an internet connection (after model download).
*   **Modular Model Management:** Easily download and swap between different GGUF models.
*   **Clean Architecture:** A logically organized file structure that separates setup, scripts, application code, and data.
*   **Documented Code:** Adheres to a strict style guide (`STYLE_GUIDE.md`) for maintainability and clarity.

## File Structure

```
.
├── models/
│   └── .gitkeep        # GGUF model files go here
├── scripts/
│   └── download_model.py # Script to fetch models from Hugging Face
├── web_ui/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── .gitignore
├── README.md           # This file
├── requirements.txt
├── run_chat_cli.py     # Main CLI for interactive chat and benchmarking
├── run_web_server.py   # Python web server to power the UI
├── setup.sh
└── STYLE_GUIDE.md
```

---

## 1. Setup

The setup process is designed to be idempotent. It creates a Python virtual environment and installs all necessary dependencies.

**Prerequisites:**
*   NVIDIA JetPack installed on your Jetson Orin.
*   A working CUDA toolkit (`nvcc` should be in your `PATH`).
*   Python 3.10 or newer.

Execute the setup script from the project root:```bash
chmod +x setup.sh
./setup.sh
```*If you encounter issues with GPU acceleration, run this script again and carefully observe the output for any compilation errors related to CUDA or `nvcc`.*

After setup, activate the virtual environment:
```bash
source .venv/bin/activate
```

---

## 2. Download a Model

Download models into the `models/` directory using the `download_model.py` script.

**Example:**
```bash
# Activate environment: source .venv/bin/activate
python scripts/download_model.py \
    --repo-id "google/gemma-3-27b-it-qat-q4_0-gguf" \
    --filename "gemma-3-27b-it-q4_0.gguf"
```

---

## 3. Usage

### Interactive Chat (CLI)

The CLI is the best tool for direct interaction and performance analysis. It starts an interactive session where you can have a conversation with the model.

**To Start the Chat:**
```bash
# Activate environment: source .venv/bin/activate
python run_chat_cli.py --model "gemma-3-27b-it-q4_0.gguf"
```
After the model loads, you will be prompted to enter your message. Type `exit` or `quit` to end the session. After each response from the assistant, detailed performance metrics for that turn will be displayed.

### Web Interface

The web interface provides a simple chat experience.

**1. Start the Server:**
```bash
# Activate environment: source .venv/bin/activate
python run_web_server.py --model "gemma-3-27b-it-q4_0.gguf"
```

**2. Open the UI:**
Once the server is running, open a web browser to:
[http://127.0.0.1:8000](http://127.0.0.1:8000)