(async () => {
  const bootContainer = document.getElementById("boot-container");
  const appRoot = document.getElementById("app-root");

  const boot = {
    apiKey: null,
    config: null,
    vfsPrefix: "_x0_vfs_",
    statePath: "/system/state.json",

    // --- Low-level VFS (localStorage) Abstraction ---
    vfs: {
      write: (path, content) => {
        try {
          localStorage.setItem(boot.vfsPrefix + path, content);
          return true;
        } catch (e) {
          boot.log(`VFS Write Error for ${path}: ${e.message}`, "error");
          return false;
        }
      },
      read: (path) => {
        try {
          return localStorage.getItem(boot.vfsPrefix + path);
        } catch (e) {
          boot.log(`VFS Read Error for ${path}: ${e.message}`, "error");
          return null;
        }
      },
      clear: () => {
        try {
          Object.keys(localStorage)
            .filter((key) => key.startsWith(boot.vfsPrefix))
            .forEach((key) => localStorage.removeItem(key));
        } catch (e) {
          boot.log(`VFS Clear Error: ${e.message}`, "error");
        }
      },
    },

    // --- UI Rendering ---
    injectStyle: () => {
      const style = document.createElement("style");
      style.textContent = `
        body { font-family: monospace; background: #000; color: #0f0; margin: 0; padding: 1em; display: flex; flex-direction: column; height: 100vh; }
        #boot-container { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }
        #log-area { flex-grow: 1; overflow-y: auto; white-space: pre-wrap; margin-bottom: 1em; }
        #log-area div { margin: 0; padding: 0; line-height: 1.3; }
        #log-area .error { color: #f00; }
        #log-area .warn { color: #ff0; }
        #log-area .info { color: #0ff; }
        #input-container { display: flex; gap: 1em; }
        #input-container label { flex-shrink: 0; }
        #input-container input { background: #000; color: #0f0; border: 1px solid #0f0; padding: 0.5em; flex-grow: 1; font-family: monospace; }
        #input-container button { background: #0f0; color: #000; border: none; padding: 0.5em 1em; cursor: pointer; }
        .hidden { display: none !important; }
      `;
      document.head.appendChild(style);
    },

    render: () => {
      bootContainer.innerHTML = `
        <div>REPLOID PRIMORDIAL HARNESS v2.0</div>
        <hr/>
        <div id="log-area"></div>
        <div id="input-container" class="hidden">
          <label for="boot-input" id="input-label"></label>
          <input type="text" id="boot-input" />
          <button id="boot-button">Submit</button>
        </div>
      `;
    },

    log: (message, level = "log") => {
      const logArea = document.getElementById("log-area");
      if (logArea) {
        const line = document.createElement("div");
        line.className = level;
        line.textContent = `> ${message}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
      }
    },

    showInput: (stage, labelText, buttonText) => {
      const inputContainer = document.getElementById("input-container");
      const inputEl = document.getElementById("boot-input");
      const labelEl = document.getElementById("input-label");
      const buttonEl = document.getElementById("boot-button");

      if (inputContainer && inputEl && labelEl && buttonEl) {
        labelEl.textContent = labelText;
        buttonEl.textContent = buttonText;
        inputEl.type = stage === "API_KEY" ? "password" : "text";
        inputContainer.classList.remove("hidden");
        inputEl.focus();

        const submitHandler = async () => {
          const value = inputEl.value.trim();
          inputContainer.classList.add("hidden");
          inputEl.value = "";
          buttonEl.removeEventListener("click", submitHandler);
          inputEl.removeEventListener("keydown", keydownHandler);
          await boot.handleInput(stage, value);
        };
        
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                submitHandler();
            }
        };

        buttonEl.addEventListener("click", submitHandler);
        inputEl.addEventListener("keydown", keydownHandler);
      }
    },

    handleInput: async (stage, value) => {
      if (stage === "API_KEY") {
        if (value && value.length > 10) {
          boot.apiKey = value;
          boot.log("API Key received.", "info");
          await boot.loadManifest();
        } else {
          boot.log("Invalid API Key provided. Please try again.", "warn");
          boot.showInput("API_KEY", "API Key:", "Submit Key");
        }
      } else if (stage === "COMPOSITION") {
        await boot.composeAgent(value);
      }
    },

    start: async () => {
      boot.injectStyle();
      boot.render();
      boot.log("Harness initialized.");

      try {
        const response = await fetch("/api_key");
        if (response.ok) {
          const data = await response.json();
          if (data.apiKey && data.apiKey.length > 10) {
            boot.apiKey = data.apiKey;
            boot.log("API Key loaded from environment.", "info");
            await boot.loadManifest();
            return;
          }
        }
        throw new Error("Local key not found or invalid.");
      } catch (e) {
        boot.log("Could not load API key locally. Please provide one.", "warn");
        boot.showInput("API_KEY", "API Key:", "Submit Key");
      }
    },

    loadManifest: async () => {
      try {
        boot.log("Loading master manifest (config.json)...");
        const response = await fetch("config.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        boot.config = await response.json();
        boot.log("Manifest loaded.", "info");
        await boot.promptForComposition();
      } catch (e) {
        boot.log(`Failed to load config.json: ${e.message}`, "error");
      }
    },

    promptForComposition: async () => {
      boot.log("\nAvailable Upgrades:");
      boot.config.upgrades.forEach((u) =>
        boot.log(`  ${u.id.padEnd(12, " ")} - ${u.description}`)
      );
      boot.log("\nAvailable Blueprints to Study:");
      boot.config.blueprints.forEach((b) =>
        boot.log(`  ${b.id.padEnd(12, " ")} - ${b.description}`)
      );
      boot.log(
        "\nDefault core composition: " + boot.config.defaultCore.join(", ")
      );
      boot.showInput(
        "COMPOSITION",
        "Compose Agent:",
        "Awaken"
      );
    },

    composeAgent: async (compositionString) => {
      boot.log("Composition received. Beginning genesis process...");
      let blueprintToStudy = null;
      let upgradesToInstall = [];

      const ids = compositionString.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

      if (ids.length > 0) {
        const blueprintId = ids.find(id => boot.config.blueprints.some(b => b.id === id));
        if (blueprintId) {
            blueprintToStudy = boot.config.blueprints.find(b => b.id === blueprintId);
        }
        const upgradeIds = ids.filter(id => boot.config.upgrades.some(u => u.id === id));
        upgradesToInstall = boot.config.upgrades.filter(u => upgradeIds.includes(u.id));
        if (upgradesToInstall.length === 0) {
            boot.log("No valid upgrades selected. Using default core.", "warn");
            upgradesToInstall = boot.config.upgrades.filter(u => boot.config.defaultCore.includes(u.id));
        }
      } else {
        boot.log("Empty composition. Using default core.");
        upgradesToInstall = boot.config.upgrades.filter(u => boot.config.defaultCore.includes(u.id));
      }

      boot.log(`Installing ${upgradesToInstall.length} upgrades: ${upgradesToInstall.map(u => u.id).join(', ')}`, "info");
      if (blueprintToStudy) {
          boot.log(`Initial goal: Study blueprint ${blueprintToStudy.id}`, "info");
      } else {
          boot.log("Initial goal: System check and report status.", "info");
      }
      
      await boot.runGenesis(upgradesToInstall, blueprintToStudy);
    },

    runGenesis: async (upgrades, blueprint) => {
        boot.log("Clearing existing VFS...");
        boot.vfs.clear();

        const artifactMetadata = {};
        const now = Date.now();
        
        const allGenesisFiles = [...upgrades, ...boot.config.blueprints];

        boot.log("Fetching and installing all genesis artifacts...");
        for (const fileDef of allGenesisFiles) {
            const isBlueprint = !!fileDef.description.toLowerCase().includes('blueprint');
            const fetchPath = isBlueprint ? `blueprints/${fileDef.path}` : `upgrades/${fileDef.path}`;
            const vfsPath = isBlueprint ? `/docs/${fileDef.path}` : `/modules/${fileDef.path}`;
            
            try {
                const res = await fetch(fetchPath);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const content = await res.text();
                boot.vfs.write(vfsPath, content);
                artifactMetadata[vfsPath] = {
                    id: vfsPath,
                    versions: [{
                        cycle: 0,
                        timestamp: now,
                        versionId: 'c0',
                    }]
                };
                boot.log(`  - Installed ${fileDef.id} to ${vfsPath}`);
            } catch (e) {
                boot.log(`Failed to install ${fileDef.id}: ${e.message}`, "error");
                return; 
            }
        }

        boot.log("Creating initial state artifact...");
        const initialGoal = blueprint 
            ? `Study the blueprint at /docs/${blueprint.path} and propose a plan for implementation.`
            : "Perform a system check, list all available modules and docs, and report status.";

        const initialState = {
            version: "2.0.0-async",
            totalCycles: 0,
            currentGoal: { seed: initialGoal, cumulative: initialGoal, stack: [] },
            apiKey: boot.apiKey,
            artifactMetadata,
            dynamicTools: [],
            registeredWebComponents: [],
        };

        boot.vfs.write(boot.statePath, JSON.stringify(initialState));
        boot.log("Genesis complete. State initialized.", "info");

        await boot.awakenAgent();
    },

    awakenAgent: async () => {
        boot.log("AWAKENING AGENT...", "info");
        try {
            const appLogicContent = boot.vfs.read("/modules/app-logic.js");
            if (!appLogicContent) {
                throw new Error("Could not read /modules/app-logic.js from VFS.");
            }
            
            // The config is now loaded by the agent itself from its VFS
            const initialConfigForAgent = {
                VFS_PREFIX: boot.vfsPrefix,
                STATE_PATH: boot.statePath
            };

            const AgentCore = new Function('config', 'vfs', appLogicContent + '\n return CoreLogicModule(config, vfs);');
            AgentCore(initialConfigForAgent, boot.vfs);

            boot.log("Agent core logic executed.");
            bootContainer.style.transition = "opacity 0.5s ease-out";
            bootContainer.style.opacity = "0";
            setTimeout(() => {
                bootContainer.classList.add("hidden");
                appRoot.style.display = "block";
                appRoot.style.opacity = "0";
                setTimeout(() => appRoot.style.opacity = "1", 50);
            }, 500);

        } catch (e) {
            boot.log(`AGENT AWAKENING FAILED: ${e.message}`, "error");
            console.error(e);
        }
    }
  };

  boot.start();
})();