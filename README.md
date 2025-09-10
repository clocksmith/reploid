# REPLOID - A Browser-Native, Self-Improving AI Agent

```
╔════════════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║     ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗██████╗                        ║
║     ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗██║██╔══██╗                       ║
║     ██████╔╝█████╗  ██████╔╝██║     ██║   ██║██║██║  ██║                       ║
║     ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║██║██║  ██║                       ║
║     ██║  ██║███████╗██║     ███████╗╚██████╔╝██║██████╔╝                       ║
║     ╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝ ╚═════╝ ╚═╝╚═════╝                        ║
║                                                                                  ║
║              🟦 An AI that builds itself, right in your browser 🟨              ║
║                                                                                  ║
╚════════════════════════════════════════════════════════════════════════════════╝
```

## 🎯 What is REPLOID?

REPLOID is an experimental, browser-native AI agent that can **modify its own code**. It operates in a secure, sandboxed Virtual File System (VFS) within your browser, with no access to your local files. This allows it to safely rewrite its own functions, create new tools, and recursively self-improve without any risk to your machine.

The system is built on a "browser-first" philosophy. It is a 100% client-side application that can be enhanced with an optional, local Node.js server for added security and convenience.

## 🚀 Quick Start

1.  **Run the Application:**
    *   **No-Install Method:** Simply open `index.html` in your browser.
    *   **Recommended Method:** Serve the directory locally to enable the full feature set, including the optional proxy.
      ```bash
      # Serve the project root directory
      python -m http.server 8000
      # Navigate to http://localhost:8000 in your browser
      ```

2.  **Run the Optional Secure Proxy (Recommended):**
    For a more secure experience that doesn't expose your API key in the browser, run the local Node.js proxy server.
    ```bash
    # Install dependencies
    npm install

    # Create a .env file from the example
    cp .env.example .env

    # Add your GEMINI_API_KEY to the .env file
    # GEMINI_API_KEY="your-api-key-here"

    # Start the server
    npm start
    ```
    The web application will automatically detect and use the proxy.

## 🧠 Core Architecture

REPLOID operates on a powerful dual-system of "Upgrades" and "Blueprints".

*   **🧬 Upgrades (Capabilities):** These are the agent's "powers" or the functions it can perform. They are modular JavaScript files (e.g., `tool-runner.js`, `state-manager.js`) that are dynamically loaded during the boot sequence.
*   **📘 Blueprints (Knowledge):** These are markdown documents that contain instructions, schemas, and architectural knowledge. The agent can read these to understand how it's built, enabling it to perform modifications and create new upgrades.

This entire system is assembled at runtime by a bootloader (`index.html`), allowing for a highly dynamic and configurable agent.

## 🎮 The Genesis Protocol (Boot Wizard)

When you first launch REPLOID, you are guided through the **Genesis Protocol** to configure your agent:

1.  **API Key:** Provide your Gemini API key. If you're running the secure proxy, this step will be skipped automatically.
2.  **Upgrades:** Select the capabilities for your agent. You can start with a minimal set or enable everything for full RSI (Recursive Self-Improvement) potential.
3.  **Blueprints:** Choose which knowledge documents to load into the agent's VFS. These are essential for self-modification tasks.
4.  **Review & Awaken:** Review your configuration, set an initial goal, and "awaken" the agent.

## 🛡️ Safety & The Virtual File System (VFS)

REPLOID is designed with safety as a primary concern.

*   **Browser Sandbox:** The agent runs entirely within the browser's security sandbox.
*   **Virtual File System:** The agent does not have access to your computer's file system. It operates on a virtual file system (VFS) stored in your browser's IndexedDB. All file operations (`read`, `write`, `search`) are simulations that act on this VFS.
*   **Project Import/Export:** You can load your own projects into the VFS by providing a `.zip` file, and export the agent's work as a new `.zip` file.

## 🔗 Integration Notes

REPLOID is designed as a browser-native application that operates within a Virtual File System (VFS). While it can read about and understand external tools like [PAWS](../paws/), it cannot directly execute shell commands or interact with the local filesystem due to browser security constraints.

For projects requiring filesystem access or shell command execution, consider:
*   Running REPLOID's concepts in a Node.js environment (future feature)
*   Using the proxy server to bridge browser and system capabilities
*   Exporting REPLOID's work via ZIP files for use with external tools

## 📁 Project Structure

```
/
├── index.html              # Main application bootloader
├── config.json             # Defines all available upgrades and blueprints
├── server/
│   └── proxy.js            # Optional Node.js secure proxy server
├── upgrades/               # Directory of all capability modules (JS files)
├── blueprints/             # Directory of all knowledge documents (MD files)
├── docs/                   # Project documentation
│   └── SYSTEM_ARCHITECTURE.md # In-depth technical details of the system
├── styles/                 # CSS for the boot wizard and UI
└── utils/                  # Client-side utility scripts
```

## 🤝 Contributing

This is an experimental project. Contributions are welcome in all areas, including:
*   New Upgrade modules and Agent Capabilities
*   New Blueprints for the agent to learn from
*   UI/UX enhancements
*   Safety and security protocols

---

*Welcome to the future of recursive self-improvement.* 🟦🟨
