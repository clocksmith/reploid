# REPLOID - Your Personal AI Teammate

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
║              🟦 An AI that learns and builds, right in your browser 🟨           ║
║                                                                                  ║
╚════════════════════════════════════════════════════════════════════════════════╝
```

## 🎯 What is REPLOID?

REPLOID is an AI agent that helps you with your tasks, right in your browser. It can write code, create content, refactor websites, and even learn new skills.

It operates in a secure, sandboxed environment, meaning it cannot access your local computer's files. Everything it does happens in a virtual workspace within your browser, ensuring your data is always safe.

## 🚀 Quick Start

1.  **Open the Application:**
    *   Simply open `index.html` in your browser.
    *   For the best experience, it's recommended to serve the directory locally:
      ```bash
      # Serve the project root directory
      python -m http.server 8000
      # Navigate to http://localhost:8000 in your browser
      ```

2.  **Choose Your Agent:**
    *   When the app loads, you'll see a simple menu of available AI "Personas."
    *   Pick a persona that matches your task, like "Website Builder" or "Creative Writer."

3.  **Set a Goal:**
    *   Tell your agent what you want to accomplish.
    *   Click "Awaken Agent" and watch it work on the live dashboard!

## 🧠 How It Works: Agent Personas

Instead of complicated setup, REPLOID uses **Personas**. Each persona is a pre-configured agent with the right skills and knowledge for a specific type of task.

This allows you to get started immediately without needing to understand the technical details. For advanced users, an "Advanced Mode" toggle is available to customize the agent's capabilities.

## 🛡️ Safety First: The Virtual Workspace

REPLOID is designed with safety as its top priority.

*   **Browser Sandbox:** The agent runs entirely within the browser's built-in security sandbox.
*   **Virtual File System:** The agent works on a virtual file system stored in your browser. It cannot read or write to your computer. You can import a project for the agent to work on, and export its work when it's done.

##  optional Secure Proxy

For a more secure experience that doesn't expose your API key in the browser, you can run the local Node.js proxy server.

```bash
# Install dependencies
npm install

# Create a .env file from the example and add your API key
cp .env.example .env

# Start the server
npm start
```
The web application will automatically detect and use the proxy.

## 📁 Project Structure

```
/
├── index.html              # Main application entry point
├── config.json             # Defines personas and available modules
├── data/
│   └── strings.json        # UI text and copy
├── server/
│   └── proxy.js            # Optional Node.js secure proxy server
├── upgrades/               # Directory of all capability modules
├── blueprints/             # Directory of all knowledge documents
├── docs/                   # Project documentation
└── styles/                 # CSS for the application
```

## 🤝 Contributing

This is an experimental project. Contributions are welcome! See `docs/PERSONAS.md` and other documentation to learn how to add new Personas and capabilities.

---

*Welcome to a new way of collaborating with AI.* 🟦🟨
