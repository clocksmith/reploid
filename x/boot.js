(async () => {
  const bootContainer = document.getElementById("boot-container");
  const appRoot = document.getElementById("app-root");

  const boot = {
    apiKey: null,
    config: null,
    vfsPrefix: "x0_vfs",
    statePath: "/system/state.json",

    // This is the default localStorage VFS. It will be replaced if 'idb' is chosen.
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

    injectStyle: () => {
      const style = document.createElement("style");
      style.textContent = `
    @keyframes glow { 0% { box-shadow: 0 0 5px rgba(0,255,255,0.5); } 50% { box-shadow: 0 0 20px rgba(0,255,255,0.8), 0 0 30px rgba(255,215,0,0.4); } 100% { box-shadow: 0 0 5px rgba(0,255,255,0.5); } }
    @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.02); } 100% { transform: scale(1); } }
    @keyframes typewriter { from { width: 0; } to { width: 100%; } }
    @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(100%); } }
    @keyframes matrixRain { 0% { transform: translateY(-100%); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(100vh); opacity: 0; } }
    
    body { 
      font-family: 'Courier New', monospace; 
      background: #000; 
      color: #0ff; 
      margin: 0; 
      padding: 0; 
      height: 100vh; 
      overflow: hidden;
      position: relative;
    }
    
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: 
        repeating-linear-gradient(
          0deg,
          rgba(0,255,255,0.03) 0px,
          transparent 1px,
          transparent 2px,
          rgba(0,255,0,0.03) 3px
        ),
        repeating-linear-gradient(
          90deg,
          transparent 0px,
          transparent 49px,
          rgba(255,215,0,0.02) 50px,
          transparent 51px,
          transparent 99px,
          rgba(255,215,0,0.02) 100px
        ),
        repeating-linear-gradient(
          0deg,
          transparent 0px,
          transparent 49px,
          rgba(255,215,0,0.02) 50px,
          transparent 51px,
          transparent 99px,
          rgba(255,215,0,0.02) 100px
        );
      pointer-events: none;
      z-index: 1;
      animation: circuitPulse 8s ease-in-out infinite;
    }
    
    @keyframes circuitPulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
    
    .matrix-bg {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
      opacity: 0.15;
      z-index: 0;
    }
    
    .matrix-column {
      position: absolute;
      top: -100%;
      font-size: 14px;
      line-height: 20px;
      animation: matrixRain 10s linear infinite;
      color: #0ff;
      text-shadow: 0 0 5px #0ff;
      white-space: pre;
    }
    
    #boot-container { 
      position: relative;
      z-index: 2;
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 20px;
      box-sizing: border-box;
      overflow-y: auto;
    }
    
    #app-root {
      position: relative;
      z-index: 3;
      height: 100vh;
      width: 100%;
    }
    
    .boot-header {
      text-align: center;
      padding: 20px 0;
      margin-bottom: 20px;
      border: 1px solid #0ff;
      position: relative;
      background: linear-gradient(135deg, rgba(0,255,255,0.1), rgba(255,215,0,0.05), rgba(0,255,255,0.05));
    }
    
    .boot-header h1 {
      margin: 0;
      font-size: 1.5em;
      text-shadow: 0 0 10px #0ff;
      background: linear-gradient(90deg, #0ff, #ffd700, #0ff, #00ffff);
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: gradient 3s ease infinite;
    }
    
    @keyframes gradient { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
    
    .wizard-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
    }
    
    .wizard-steps {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
      padding: 0 20px;
    }
    
    .wizard-step {
      flex: 1;
      text-align: center;
      padding: 10px;
      border: 1px solid #333;
      margin: 0 5px;
      cursor: pointer;
      transition: all 0.3s;
      position: relative;
      background: rgba(0,255,255,0.05);
    }
    
    .wizard-step.active {
      border-color: #0ff;
      background: rgba(0,255,255,0.1);
      animation: glow 2s infinite;
    }
    
    .wizard-step.completed {
      border-color: #0a0;
      background: rgba(255,215,0,0.15);
    }
    
    .wizard-content {
      flex: 1;
      border: 1px solid #0ff;
      padding: 20px;
      position: relative;
      display: flex;
      gap: 20px;
      background: rgba(0,0,0,0);
    }
    
    .selection-panel {
      flex: 2;
      overflow-y: auto;
      padding-right: 10px;
    }
    
    .preview-panel {
      flex: 1;
      border-left: 1px solid #0ff;
      padding-left: 20px;
    }
    
    .preview-panel h3 {
      color: #0ff;
      margin-top: 0;
    }
    
    .preview-box {
      border: 1px solid #444;
      padding: 15px;
      font-size: 0.9em;
      background: rgba(0,255,255,0.02);
    }
    
    .selection-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }
    
    .selection-card {
      border: 1px solid #444;
      padding: 15px;
      cursor: pointer;
      transition: all 0.3s;
      position: relative;
      background: rgba(0,0,0,0.5);
    }
    
    .selection-card:hover {
      border-color: #0ff;
      transform: translateY(-2px);
      background: rgba(0,255,255,0.05);
    }
    
    .selection-card.selected {
      border-color: #0ff;
      background: rgba(0,255,255,0.1);
      animation: pulse 2s infinite;
    }
    
    .selection-card input[type="checkbox"] {
      position: absolute;
      top: 10px;
      right: 10px;
      pointer-events: none;
      filter: hue-rotate(90deg) brightness(1.5);
    }
    
    .selection-card-title {
      font-weight: bold;
      margin-bottom: 8px;
      color: #0ff;
    }
    
    .selection-card-desc {
      font-size: 0.85em;
      color: #aaa;
      line-height: 1.4;
    }
    
    .tooltip {
      position: absolute;
      background: #000;
      border: 1px solid #0ff;
      padding: 10px;
      z-index: 1000;
      max-width: 300px;
      font-size: 0.85em;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s;
      box-shadow: 0 0 20px rgba(255,215,0,0.3);
    }
    
    .tooltip.visible {
      opacity: 1;
    }
    
    .preset-buttons {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    
    .preset-btn {
      padding: 8px 16px;
      border: 1px solid #444;
      background: rgba(0,0,0,0.5);
      color: #0ff;
      cursor: pointer;
      transition: all 0.3s;
      font-family: inherit;
    }
    
    .preset-btn:hover {
      border-color: #0ff;
      background: rgba(0,255,255,0.1);
    }
    
    .collapsible-section {
      margin-bottom: 20px;
    }
    
    .collapsible-header {
      padding: 10px;
      border: 1px solid #444;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(0,255,255,0.02);
      transition: all 0.3s;
    }
    
    .collapsible-header:hover {
      border-color: #0ff;
      background: rgba(0,255,255,0.05);
    }
    
    .collapsible-header.collapsed::after {
      content: ' [+]';
    }
    
    .collapsible-header:not(.collapsed)::after {
      content: ' [-]';
    }
    
    .collapsible-content {
      max-height: 1000px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }
    
    .collapsible-content.collapsed {
      max-height: 0;
    }
    
    .progress-bar {
      width: 100%;
      height: 30px;
      border: 1px solid #0ff;
      background: #000;
      position: relative;
      overflow: hidden;
      margin: 20px 0;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #0ff, #ffd700, #0ff);
      transition: width 0.5s ease;
      box-shadow: 0 0 20px rgba(0,255,255,0.5);
    }
    
    .progress-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      text-shadow: 0 0 5px #000;
      z-index: 1;
    }
    
    .action-buttons {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
      padding: 20px;
    }
    
    .btn {
      padding: 10px 30px;
      border: 1px solid #0ff;
      background: rgba(0,255,255,0.1);
      color: #0ff;
      cursor: pointer;
      font-family: inherit;
      font-size: 1em;
      transition: all 0.3s;
    }
    
    .btn:hover:not(:disabled) {
      background: rgba(0,255,255,0.2);
      box-shadow: 0 0 20px rgba(0,255,255,0.5);
    }
    
    .btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    .btn.primary {
      background: rgba(255,215,0,0.2);
      animation: glow 2s infinite;
    }
    
    .btn.awaken {
      background: linear-gradient(90deg, rgba(0,255,255,0.3), rgba(255,215,0,0.2), rgba(0,255,255,0.2));
      animation: glow 1s infinite, gradient 3s ease infinite;
      font-weight: bold;
      text-shadow: 0 0 10px #0ff;
    }
    
    .cli-fallback {
      margin-top: 20px;
      padding: 15px;
      border: 1px solid #333;
      background: rgba(0,0,0,0.5);
    }
    
    .cli-input {
      width: 100%;
      background: #000;
      color: #0ff;
      border: 1px solid #444;
      padding: 8px;
      font-family: inherit;
      margin-top: 10px;
    }
    
    .cli-input:focus {
      outline: none;
      border-color: #0ff;
    }
    
    #log-area { 
      max-height: 200px;
      overflow-y: auto; 
      white-space: pre-wrap; 
      margin-bottom: 1em;
      border: 1px solid #333;
      padding: 10px;
      background: rgba(0,0,0,0.5);
    }
    #log-area div {
      padding: 2px 0;
      line-height: 1.3;
    }
    #log-area .error { color: #f00; }
    #log-area .warn { color: #fa0; }
    #log-area .info { color: #0ff; }
    #log-area .success { color: #0f0; }
    .hidden { display: none !important; }
  `;
      document.head.appendChild(style);
    },

    currentStep: 0,
    selectedUpgrades: [],
    selectedBlueprints: [],
    tooltip: null,

    render: () => {
      // Create matrix rain background with circuit effect
      const matrixBg = document.createElement("div");
      matrixBg.className = "matrix-bg";

      // Add more columns for denser effect
      for (let i = 0; i < 30; i++) {
        const column = document.createElement("div");
        column.className = "matrix-column";
        column.style.left = `${i * 3.3}%`;
        column.style.animationDelay = `${Math.random() * 10}s`;
        column.style.animationDuration = `${10 + Math.random() * 10}s`;

        let chars = "";
        for (let j = 0; j < 50; j++) {
          // Mix of characters and circuit-like symbols
          const rand = Math.random();
          if (rand > 0.7) {
            chars += String.fromCharCode(0x30a0 + Math.random() * 96); // Japanese chars
          } else if (rand > 0.4) {
            chars += Math.floor(Math.random() * 2); // Binary
          } else if (rand > 0.2) {
            chars += ["─", "│", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"][
              Math.floor(Math.random() * 11)
            ]; // Circuit lines
          } else {
            chars += ["●", "○", "■", "□", "▪", "▫"][
              Math.floor(Math.random() * 6)
            ]; // Nodes
          }
          chars += "\n";
        }
        column.textContent = chars;
        matrixBg.appendChild(column);
      }
      document.body.appendChild(matrixBg);

      bootContainer.innerHTML = `
    <div class="boot-header">
      <pre style="color: #0ff; font-size: 0.8em; margin: 0;">
╔═════════════════════════════════════════════════════════════╗
║     █████╗  ███████╗██████╗ ██╗      ██████╗ ██╗██████╗     ║
║     ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗██║██╔══██╗    ║
║     ██████╔╝█████╗  ██████╔╝██║     ██║   ██║██║██║  ██║    ║
║     ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║██║██║  ██║    ║
║     ██║  ██║███████╗██║     ███████╗╚██████╔╝██║██████╔╝    ║
║     ╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝ ╚═════╝ ╚═╝╚═════╝     ║
╚═════════════════════════════════════════════════════════════╝
      </pre>
      <h1>Model CPS-9204</h1>
    </div>
    <div class="wizard-container">
      <div class="wizard-steps">
        <div class="wizard-step" data-step="0">┌─ API KEY ─┐</div>
        <div class="wizard-step" data-step="1">┌─ UPGRADES ─┐</div>
        <div class="wizard-step" data-step="2">┌─ BLUEPRINTS ─┐</div>
        <div class="wizard-step" data-step="3">┌─ REVIEW ─┐</div>
        <div class="wizard-step" data-step="4">┌─ GENESIS ─┐</div>
      </div>
      <div class="wizard-content">
        <div class="step-content"></div>
      </div>
      <div class="action-buttons">
        <button class="btn" id="prev-btn">◄ BACK</button>
        <button class="btn primary" id="next-btn">NEXT ►</button>
      </div>
    </div>
    <div id="log-area" class="hidden"></div>
    <div class="tooltip" id="tooltip"></div>
  `;

      boot.tooltip = document.getElementById("tooltip");
      boot.setupWizardNavigation();
      boot.updateWizardStep();
    },

    setupWizardNavigation: () => {
      const handleNext = async () => {
        if (boot.currentStep < 4) {
          const isValid = await boot.validateCurrentStep();
          if (isValid) {
            boot.currentStep++;
            boot.updateWizardStep();
          }
        } else if (boot.currentStep === 4) {
          boot.initiateGenesis();
        }
      };

      const handlePrev = () => {
        if (boot.currentStep > 0) {
          boot.currentStep--;
          boot.updateWizardStep();
        }
      };

      document.getElementById("prev-btn").addEventListener("click", handlePrev);
      document.getElementById("next-btn").addEventListener("click", handleNext);

      // Add global Enter key handler
      document.addEventListener("keydown", async (e) => {
        if (e.key === "Enter" && !e.target.matches("input, textarea")) {
          await handleNext();
        }
      });

      document.querySelectorAll(".wizard-step").forEach((step, index) => {
        step.addEventListener("click", () => {
          if (index < boot.currentStep || index === boot.currentStep) {
            boot.currentStep = index;
            boot.updateWizardStep();
          }
        });
      });
    },

    updateWizardStep: () => {
      // Update step indicators
      document.querySelectorAll(".wizard-step").forEach((step, index) => {
        step.classList.remove("active", "completed");
        if (index === boot.currentStep) {
          step.classList.add("active");
        } else if (index < boot.currentStep) {
          step.classList.add("completed");
        }
      });

      // Update content
      const contentDiv = document.querySelector(".step-content");
      switch (boot.currentStep) {
        case 0:
          boot.renderApiKeyStep(contentDiv);
          break;
        case 1:
          boot.renderUpgradesStep(contentDiv);
          break;
        case 2:
          boot.renderBlueprintsStep(contentDiv);
          break;
        case 3:
          boot.renderReviewStep(contentDiv);
          break;
        case 4:
          boot.renderGenesisStep(contentDiv);
          break;
      }

      // Update buttons
      const prevBtn = document.getElementById("prev-btn");
      const nextBtn = document.getElementById("next-btn");
      prevBtn.disabled = boot.currentStep === 0;
      if (boot.currentStep === 4) {
        nextBtn.textContent = "AWAKEN ►";
        nextBtn.classList.add("awaken");
      } else if (boot.currentStep === 3) {
        nextBtn.textContent = "PREPARE ►";
      } else {
        nextBtn.textContent = "NEXT ►";
        nextBtn.classList.remove("awaken");
      }
    },

    renderApiKeyStep: (container) => {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <h2 style="color: #0ff; margin-bottom: 30px;">┌─ AUTHENTICATION REQUIRED ─┐</h2>
          <p style="margin-bottom: 30px;">Enter your API key to initialize the harness</p>
          <input type="password" id="api-key-input" 
                 style="width: 420px; max-width: 100%; padding: 10px; background: transparent; 
                        color: #0ff; border: 1px solid #0ff; font-family: inherit; font-size: 1.1em;"
                 placeholder="sk-..." 
                 value="${boot.apiKey || ""}" />
          <div style="margin-top: 20px; color: #888; font-size: 0.9em;">
            Your API key is stored locally and never transmitted
          </div>
        </div>
      `;
      const apiInput = document.getElementById("api-key-input");
      apiInput.focus();

      // Enter key submits API key and moves to next step
      apiInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          boot.apiKey = apiInput.value;
          const isValid = await boot.validateCurrentStep();
          if (isValid) {
            boot.currentStep++;
            boot.updateWizardStep();
          }
        }
      });
    },

    renderUpgradesStep: (container) => {
      if (!boot.config) return;

      container.innerHTML = `
        <div class="selection-panel">
          <h2 style="color: #0ff;">┌─ SELECT UPGRADES ─┐</h2>
          <p style="color: #888;">Choose capabilities to install in the agent</p>
          
          <div class="preset-buttons">
            <button class="preset-btn" data-preset="minimal">MINIMAL</button>
            <button class="preset-btn" data-preset="standard">STANDARD</button>
            <button class="preset-btn" data-preset="full">FULL SUITE</button>
          </div>
          
          <div class="collapsible-section">
            <div class="collapsible-header" id="core-header">
              <span>Core Upgrades <span id="core-summary" style="color: #888;"></span></span>
            </div>
            <div class="collapsible-content" id="core-content">
              <div class="selection-grid" id="core-upgrades"></div>
            </div>
          </div>
          
          <div class="collapsible-section">
            <div class="collapsible-header" id="advanced-header">
              <span>Advanced Upgrades <span id="advanced-summary" style="color: #888;"></span></span>
            </div>
            <div class="collapsible-content" id="advanced-content">
              <div class="selection-grid" id="advanced-upgrades"></div>
            </div>
          </div>
          
          <div class="cli-fallback">
            <details>
              <summary style="cursor: pointer; color: #888;">Advanced: Manual Input</summary>
              <input type="text" class="cli-input" id="manual-upgrades" 
                     placeholder="Enter comma-separated upgrade IDs (e.g., cyc, sm, ui)" />
            </details>
          </div>
        </div>
        
        <div class="preview-panel">
          <h3>┌─ COMPOSITION PREVIEW ─┐</h3>
          <div class="preview-box" id="upgrades-preview">
            <div style="color: #888;">No upgrades selected</div>
          </div>
        </div>
      `;

      // Populate upgrades
      const coreUpgrades = boot.config.upgrades.filter((u) =>
        boot.config.defaultCore.includes(u.id)
      );
      const advancedUpgrades = boot.config.upgrades.filter(
        (u) => !boot.config.defaultCore.includes(u.id)
      );

      boot.renderUpgradeCards("core-upgrades", coreUpgrades);
      boot.renderUpgradeCards("advanced-upgrades", advancedUpgrades);

      // Setup collapsible sections
      boot.setupCollapsible("core-header", "core-content");
      boot.setupCollapsible("advanced-header", "advanced-content");

      // Setup preset buttons
      document.querySelectorAll(".preset-btn").forEach((btn) => {
        btn.addEventListener("click", () =>
          boot.applyPreset(btn.dataset.preset)
        );
      });

      // Setup manual input
      document
        .getElementById("manual-upgrades")
        .addEventListener("input", (e) => {
          boot.parseManualUpgrades(e.target.value);
        });

      boot.updateUpgradesSummary();
      boot.updateUpgradesPreview();
    },

    renderBlueprintsStep: (container) => {
      if (!boot.config) return;

      container.innerHTML = `
        <div class="selection-panel">
          <h2 style="color: #0ff;">┌─ SELECT BLUEPRINTS ─┐</h2>
          <p style="color: #888;">Choose blueprints for the agent to study (optional)</p>
          
          <div class="selection-grid" id="blueprints-grid"></div>
          
          <div class="cli-fallback">
            <details>
              <summary style="cursor: pointer; color: #888;">Advanced: Manual Input</summary>
              <input type="text" class="cli-input" id="manual-blueprints" 
                     placeholder="Enter comma-separated blueprint IDs (e.g., 0x000011, 0x000012)" />
            </details>
          </div>
        </div>
        
        <div class="preview-panel">
          <h3>┌─ SELECTED BLUEPRINTS ─┐</h3>
          <div class="preview-box" id="blueprints-preview">
            <div style="color: #888;">No blueprints selected</div>
          </div>
        </div>
      `;

      boot.renderBlueprintCards("blueprints-grid", boot.config.blueprints);

      // Setup manual input
      document
        .getElementById("manual-blueprints")
        .addEventListener("input", (e) => {
          boot.parseManualBlueprints(e.target.value);
        });

      boot.updateBlueprintsPreview();
    },

    renderReviewStep: (container) => {
      const upgradesText =
        boot.selectedUpgrades.length > 0
          ? boot.selectedUpgrades.join(", ")
          : "None (default core will be used)";

      const blueprintsText =
        boot.selectedBlueprints.length > 0
          ? boot.selectedBlueprints.join(", ")
          : "None";

      container.innerHTML = `
        <div style="padding: 40px;">
          <h2 style="color: #0ff; text-align: center; margin-bottom: 40px;">┌─ GENESIS CONFIGURATION ─┐</h2>
          
          <div style="display: grid; gap: 30px;">
            <div style="border: 1px solid #444; padding: 20px; background: rgba(0,255,0,0.02);">
              <h3 style="color: #0ff; margin-top: 0;">UPGRADES</h3>
              <pre style="color: #aaa; margin: 0; white-space: pre-wrap;">${upgradesText}</pre>
            </div>
            
            <div style="border: 1px solid #444; padding: 20px; background: rgba(0,255,0,0.02);">
              <h3 style="color: #0ff; margin-top: 0;">BLUEPRINTS</h3>
              <pre style="color: #aaa; margin: 0; white-space: pre-wrap;">${blueprintsText}</pre>
            </div>
            
            <div style="border: 1px solid #444; padding: 20px; background: rgba(0,255,0,0.02);">
              <h3 style="color: #0ff; margin-top: 0;">INITIAL GOAL</h3>
              <pre style="color: #aaa; margin: 0; white-space: pre-wrap;">${
                boot.selectedBlueprints.length > 0
                  ? `Study blueprints: ${blueprintsText}`
                  : "System check and report status"
              }</pre>
            </div>
          </div>
          
        </div>
      `;
    },

    renderGenesisStep: (container) => {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <h2 style="color: #0ff; margin-bottom: 30px;">┌─ GENESIS PROTOCOL ─┐</h2>
          
          <div class="progress-bar">
            <div class="progress-fill" id="genesis-progress" style="width: 0%;"></div>
            <div class="progress-text" id="genesis-text">Initializing...</div>
          </div>
          
          <div id="genesis-log" style="margin-top: 30px; text-align: left; 
                                        border: 1px solid #333; padding: 20px; 
                                        background: rgba(0,0,0,0.5); 
                                        max-height: 300px; overflow-y: auto;">
          </div>
          
          <div style="text-align: center; margin-top: 40px; color: #f0f; 
                      text-shadow: 0 0 10px #ffd700; animation: pulse 2s infinite;">
            Press AWAKEN to initiate genesis protocol
          </div>
        </div>
      `;
    },

    renderUpgradeCards: (containerId, upgrades) => {
      const container = document.getElementById(containerId);
      upgrades.forEach((upgrade) => {
        const card = document.createElement("div");
        card.className = "selection-card";
        card.dataset.id = upgrade.id;
        card.dataset.type = "upgrade";

        const isSelected = boot.selectedUpgrades.includes(upgrade.id);
        if (isSelected) card.classList.add("selected");

        card.innerHTML = `
          <input type="checkbox" ${isSelected ? "checked" : ""} />
          <div class="selection-card-title">${upgrade.id.toUpperCase()}</div>
          <div class="selection-card-desc">${upgrade.description}</div>
        `;

        card.addEventListener("click", () =>
          boot.toggleSelection(card, "upgrade")
        );
        card.addEventListener("mouseenter", (e) =>
          boot.showTooltip(e, upgrade)
        );
        card.addEventListener("mouseleave", () => boot.hideTooltip());

        container.appendChild(card);
      });
    },

    renderBlueprintCards: (containerId, blueprints) => {
      const container = document.getElementById(containerId);
      blueprints.forEach((blueprint) => {
        const card = document.createElement("div");
        card.className = "selection-card";
        card.dataset.id = blueprint.id;
        card.dataset.type = "blueprint";

        const isSelected = boot.selectedBlueprints.includes(blueprint.id);
        if (isSelected) card.classList.add("selected");

        card.innerHTML = `
          <input type="checkbox" ${isSelected ? "checked" : ""} />
          <div class="selection-card-title">${blueprint.id.toUpperCase()}</div>
          <div class="selection-card-desc">${blueprint.description}</div>
        `;

        card.addEventListener("click", () =>
          boot.toggleSelection(card, "blueprint")
        );
        card.addEventListener("mouseenter", (e) =>
          boot.showTooltip(e, blueprint)
        );
        card.addEventListener("mouseleave", () => boot.hideTooltip());

        container.appendChild(card);
      });
    },

    toggleSelection: (card, type) => {
      const id = card.dataset.id;
      const checkbox = card.querySelector('input[type="checkbox"]');

      if (type === "upgrade") {
        const index = boot.selectedUpgrades.indexOf(id);
        if (index > -1) {
          boot.selectedUpgrades.splice(index, 1);
          card.classList.remove("selected");
          checkbox.checked = false;
        } else {
          boot.selectedUpgrades.push(id);
          card.classList.add("selected");
          checkbox.checked = true;
        }
        boot.updateUpgradesSummary();
        boot.updateUpgradesPreview();
      } else if (type === "blueprint") {
        const index = boot.selectedBlueprints.indexOf(id);
        if (index > -1) {
          boot.selectedBlueprints.splice(index, 1);
          card.classList.remove("selected");
          checkbox.checked = false;
        } else {
          boot.selectedBlueprints.push(id);
          card.classList.add("selected");
          checkbox.checked = true;
        }
        boot.updateBlueprintsPreview();
      }
    },

    showTooltip: (event, item) => {
      if (!boot.tooltip) return;

      const rect = event.target.getBoundingClientRect();
      boot.tooltip.innerHTML = `
        <div style="color: #0ff; font-weight: bold; margin-bottom: 8px;">${item.id.toUpperCase()}</div>
        <div style="color: #aaa; font-size: 0.9em; line-height: 1.4;">${
          item.description
        }</div>
        ${
          item.path
            ? `<div style="color: #888; font-size: 0.8em; margin-top: 8px;">Path: ${item.path}</div>`
            : ""
        }
      `;

      boot.tooltip.style.left = rect.right + 10 + "px";
      boot.tooltip.style.top = rect.top + "px";
      boot.tooltip.classList.add("visible");
    },

    hideTooltip: () => {
      if (boot.tooltip) {
        boot.tooltip.classList.remove("visible");
      }
    },

    setupCollapsible: (headerId, contentId) => {
      const header = document.getElementById(headerId);
      const content = document.getElementById(contentId);

      header.addEventListener("click", () => {
        header.classList.toggle("collapsed");
        content.classList.toggle("collapsed");
      });
    },

    updateUpgradesSummary: () => {
      const coreCount = boot.selectedUpgrades.filter((id) =>
        boot.config.defaultCore.includes(id)
      ).length;
      const advCount = boot.selectedUpgrades.filter(
        (id) => !boot.config.defaultCore.includes(id)
      ).length;

      const coreSummary = document.getElementById("core-summary");
      const advSummary = document.getElementById("advanced-summary");

      if (coreSummary)
        coreSummary.textContent =
          coreCount > 0 ? `(${coreCount} selected)` : "";
      if (advSummary)
        advSummary.textContent = advCount > 0 ? `(${advCount} selected)` : "";
    },

    updateUpgradesPreview: () => {
      const preview = document.getElementById("upgrades-preview");
      if (!preview) return;

      if (boot.selectedUpgrades.length === 0) {
        preview.innerHTML =
          '<div style="color: #888;">No upgrades selected</div>';
      } else {
        preview.innerHTML = `
          <div style="color: #0ff; margin-bottom: 10px;">Selected Upgrades (${
            boot.selectedUpgrades.length
          }):</div>
          <div style="color: #aaa;">${boot.selectedUpgrades.join(", ")}</div>
        `;
      }
    },

    updateBlueprintsPreview: () => {
      const preview = document.getElementById("blueprints-preview");
      if (!preview) return;

      if (boot.selectedBlueprints.length === 0) {
        preview.innerHTML =
          '<div style="color: #888;">No blueprints selected</div>';
      } else {
        preview.innerHTML = `
          <div style="color: #0ff; margin-bottom: 10px;">Selected Blueprints (${
            boot.selectedBlueprints.length
          }):</div>
          <div style="color: #aaa;">${boot.selectedBlueprints.join(", ")}</div>
        `;
      }
    },

    applyPreset: (preset) => {
      // Clear current selections
      boot.selectedUpgrades = [];
      document
        .querySelectorAll('.selection-card[data-type="upgrade"]')
        .forEach((card) => {
          card.classList.remove("selected");
          card.querySelector('input[type="checkbox"]').checked = false;
        });

      // Apply preset
      let presetUpgrades = [];
      switch (preset) {
        case "minimal":
          presetUpgrades = ["cyc", "sm", "ui"];
          break;
        case "standard":
          presetUpgrades = boot.config.defaultCore;
          break;
        case "full":
          presetUpgrades = boot.config.upgrades.map((u) => u.id);
          break;
      }

      // Select the preset upgrades
      presetUpgrades.forEach((id) => {
        const card = document.querySelector(`.selection-card[data-id="${id}"]`);
        if (card) {
          boot.selectedUpgrades.push(id);
          card.classList.add("selected");
          card.querySelector('input[type="checkbox"]').checked = true;
        }
      });

      boot.updateUpgradesSummary();
      boot.updateUpgradesPreview();
    },

    parseManualUpgrades: (input) => {
      const ids = input
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Clear and reselect based on manual input
      boot.selectedUpgrades = [];
      document
        .querySelectorAll('.selection-card[data-type="upgrade"]')
        .forEach((card) => {
          const isSelected = ids.includes(card.dataset.id);
          card.classList.toggle("selected", isSelected);
          card.querySelector('input[type="checkbox"]').checked = isSelected;
          if (isSelected) boot.selectedUpgrades.push(card.dataset.id);
        });

      boot.updateUpgradesSummary();
      boot.updateUpgradesPreview();
    },

    parseManualBlueprints: (input) => {
      const ids = input
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Clear and reselect based on manual input
      boot.selectedBlueprints = [];
      document
        .querySelectorAll('.selection-card[data-type="blueprint"]')
        .forEach((card) => {
          const isSelected = ids.includes(card.dataset.id);
          card.classList.toggle("selected", isSelected);
          card.querySelector('input[type="checkbox"]').checked = isSelected;
          if (isSelected) boot.selectedBlueprints.push(card.dataset.id);
        });

      boot.updateBlueprintsPreview();
    },

    validateCurrentStep: async () => {
      switch (boot.currentStep) {
        case 0:
          const apiKey = document.getElementById("api-key-input")?.value;
          if (!apiKey || apiKey.length < 10) {
            alert("Please enter a valid API key");
            return false;
          }
          boot.apiKey = apiKey;
          if (!boot.config) {
            const loaded = await boot.loadManifest();
            if (!loaded) {
              return false;
            }
          }
          return true;
        case 1:
        case 2:
        case 3:
          return true;
        default:
          return false;
      }
    },

    initiateGenesis: async () => {
      const progressBar = document.getElementById("genesis-progress");
      const progressText = document.getElementById("genesis-text");
      const genesisLog = document.getElementById("genesis-log");

      // Prepare upgrades and blueprints
      let upgradesToInstall =
        boot.selectedUpgrades.length > 0
          ? boot.config.upgrades.filter((u) =>
              boot.selectedUpgrades.includes(u.id)
            )
          : boot.config.upgrades.filter((u) =>
              boot.config.defaultCore.includes(u.id)
            );

      let blueprintsToStudy =
        boot.selectedBlueprints.length > 0
          ? boot.config.blueprints.filter((b) =>
              boot.selectedBlueprints.includes(b.id)
            )
          : [];

      // Determine which VFS to use based on selected upgrades.
      const useIdb = upgradesToInstall.some((u) => u.id === "idb");
      if (useIdb) {
        // Replace the default localStorage vfs with the IDB implementation.
        boot.vfs = BootIdbVfs({ VFS_PREFIX: boot.vfsPrefix });
      }

      // Start genesis with progress animation
      await boot.runGenesisWithProgress(
        upgradesToInstall,
        blueprintsToStudy,
        progressBar,
        progressText,
        genesisLog
      );
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

    // Keep for backward compatibility but not used in new UI
    showInput: () => {},
    handleInput: () => {},

    start: async () => {
      boot.injectStyle();
      boot.render();
    },

    loadManifest: async () => {
      try {
        const response = await fetch("config.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        boot.config = await response.json();
        return true;
      } catch (e) {
        alert(`Failed to load config.json: ${e.message}`);
        return false;
      }
    },

    // Removed old composition methods - now handled by wizard UI

    runGenesisWithProgress: async (
      upgrades,
      blueprints,
      progressBar,
      progressText,
      logDiv
    ) => {
      const addLog = (msg, color = "#0ff") => {
        if (logDiv) {
          const line = document.createElement("div");
          line.style.color = color;
          line.textContent = `> ${msg}`;
          logDiv.appendChild(line);
          logDiv.scrollTop = logDiv.scrollHeight;
        }
      };

      const updateProgress = (percent, text) => {
        if (progressBar) progressBar.style.width = percent + "%";
        if (progressText) progressText.textContent = text;
      };

      updateProgress(10, "Clearing VFS...");
      addLog("Clearing existing VFS...");
      await boot.vfs.clear();

      const artifactMetadata = {};
      const now = Date.now();

      // Combine upgrades and selected blueprints
      const allGenesisFiles = [...upgrades, ...blueprints];

      updateProgress(20, "Fetching genesis artifacts...");
      addLog("Fetching and installing all genesis artifacts...");

      let fileCount = 0;
      const totalFiles = allGenesisFiles.length;

      for (const fileDef of allGenesisFiles) {
        const isBlueprint = blueprints.some((b) => b.id === fileDef.id);
        const fetchPath = isBlueprint
          ? `blueprints/${fileDef.path}`
          : `upgrades/${fileDef.path}`;
        const vfsPath = isBlueprint
          ? `/docs/${fileDef.path}`
          : `/modules/${fileDef.path}`;

        try {
          const res = await fetch(fetchPath);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const content = await res.text();
          await boot.vfs.write(vfsPath, content);
          artifactMetadata[vfsPath] = {
            id: vfsPath,
            versions: [
              {
                cycle: 0,
                timestamp: now,
                versionId: "c0",
              },
            ],
          };

          fileCount++;
          const progress = 20 + (fileCount / totalFiles) * 60;
          updateProgress(progress, `Installing ${fileDef.id}...`);
          addLog(`Installed ${fileDef.id} to ${vfsPath}`, "#ffd700");
        } catch (e) {
          addLog(`Failed to install ${fileDef.id}: ${e.message}`, "#f00");
          return;
        }
      }

      updateProgress(85, "Creating initial state...");
      addLog("Creating initial state artifact...");

      const initialGoal =
        blueprints.length > 0
          ? `Study the blueprints at ${blueprints
              .map((b) => `/docs/${b.path}`)
              .join(", ")} and propose a plan for implementation.`
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

      await boot.vfs.write(boot.statePath, JSON.stringify(initialState));

      updateProgress(95, "Awakening agent...");
      addLog("Genesis complete. State initialized.", "#ffd700");
      addLog("AWAKENING AGENT...", "#ffd700");

      // Small delay for visual effect
      await new Promise((resolve) => setTimeout(resolve, 500));
      updateProgress(100, "Complete!");

      await boot.awakenAgent();
    },

    awakenAgent: async () => {
      console.log(
        "AWAKENING AGENT: Handing off control to VFS /modules/app-logic.js"
      );
      try {
        const appLogicContent = boot.vfs.read("/modules/app-logic.js");
        if (!appLogicContent) {
          throw new Error("Could not read /modules/app-logic.js from VFS.");
        }

        const initialConfigForAgent = {
          VFS_PREFIX: boot.vfsPrefix,
          STATE_PATH: boot.statePath,
        };

        const AgentCore = new Function(
          "config",
          "vfs",
          appLogicContent + "\n return CoreLogicModule(config, vfs);"
        );

        // This is the moment of awakening. The bootloader's final act is to
        // execute the agent's core orchestrator from the VFS.
        AgentCore(initialConfigForAgent, boot.vfs);

        console.log("HANDOVER COMPLETE. Bootloader is now inert.");
      } catch (e) {
        console.error("AGENT AWAKENING FAILED:", e);
        const genesisLog = document.getElementById("genesis-log");
        if (genesisLog) {
          const errorLine = document.createElement("div");
          errorLine.style.color = "#f00";
          errorLine.textContent = `> AWAKENING FAILED: ${e.message}`;
          genesisLog.appendChild(errorLine);
        }
      }
    },
  };

  boot.start();
})();
