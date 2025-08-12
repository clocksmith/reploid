const UIModule = (config, logger, Utils, Storage, StateManager, Errors) => {
  let uiRefs = {};
  let CycleLogic = null;

  const initializeUIElementReferences = () => {
    const ids = [
        "run-cycle-button", "goal-input", "status-indicator",
        "metrics-display", "current-cycle-content", "timeline-log",
        "human-intervention-section", "human-intervention-title",
        "human-intervention-reason", "human-critique-input", "submit-critique-button"
    ];
    ids.forEach(id => {
        uiRefs[Utils.kabobToCamel(id)] = document.getElementById(id);
    });
  };

  const updateStatus = (message) => {
    if (uiRefs.statusIndicator) {
      uiRefs.statusIndicator.textContent = `Status: ${message}`;
    }
  };

  const logToTimeline = (cycle, message, type = "info") => {
    if (!uiRefs.timelineLog) return;
    const li = document.createElement("li");
    li.innerHTML = `<span>[C${cycle}]</span> <span>[${type.toUpperCase()}]</span> ${Utils.escapeHtml(message)}`;
    uiRefs.timelineLog.insertBefore(li, uiRefs.timelineLog.firstChild);
    if (uiRefs.timelineLog.children.length > 100) {
        uiRefs.timelineLog.removeChild(uiRefs.timelineLog.lastChild);
    }
  };

  const updateStateDisplay = async () => {
    if (!uiRefs.metricsDisplay || !StateManager) return;
    // Since getState is now cheap (in-memory read), we don't need to make this async,
    // but the data it displays might be from a slightly older state if a cycle is in progress.
    const state = StateManager.getState();
    if (!state) return;
    uiRefs.metricsDisplay.innerHTML = `Cycle: <strong>${state.totalCycles || 0}</strong>`;
  };

  const displayCycleArtifact = (label, content, type, source, artifactId) => {
      if (!uiRefs.currentCycleContent) return;
      if (uiRefs.currentCycleContent.innerHTML.includes("Waiting for cycle")) {
          uiRefs.currentCycleContent.innerHTML = "";
      }
      const section = document.createElement("div");
      section.className = "artifact-section";
      section.innerHTML = `
        <h4>${Utils.escapeHtml(label)} (${type})</h4>
        <pre><code>${Utils.escapeHtml(String(content))}</code></pre>
      `;
      uiRefs.currentCycleContent.appendChild(section);
  };
  
  const clearCurrentCycleDetails = () => {
      if (uiRefs.currentCycleContent) {
          uiRefs.currentCycleContent.innerHTML = "<p>Waiting for cycle...</p>";
      }
  };

  const setRunButtonState = (text, disabled) => {
      if (uiRefs.runCycleButton) {
          uiRefs.runCycleButton.textContent = text;
          uiRefs.runCycleButton.disabled = disabled;
      }
  };
  
  const showHumanInterventionUI = (mode, reason) => {
      if (uiRefs.humanInterventionSection) {
          uiRefs.humanInterventionSection.classList.remove('hidden');
          if(uiRefs.humanInterventionReason) uiRefs.humanInterventionReason.textContent = reason;
          if(uiRefs.humanCritiqueInput) uiRefs.humanCritiqueInput.focus();
      }
  };

  const setupEventListeners = () => {
      uiRefs.runCycleButton?.addEventListener('click', async () => {
          if (CycleLogic.isRunning()) {
              CycleLogic.abortCurrentCycle();
          } else {
              // The executeCycle is now async, but the click handler doesn't need to await it.
              // It kicks off the process and the UI will update via its own methods.
              CycleLogic.executeCycle();
          }
      });
  };

  const init = async (injectedStateManager, injectedCycleLogic) => {
    logger.logEvent("info", "Agent UIManager taking control of DOM...");
    StateManager = injectedStateManager;
    CycleLogic = injectedCycleLogic;

    // --- JETTISON THE BOOTLOADER ---
    // The agent's first act is to remove the temporary bootloader UI.
    const bootContainer = document.getElementById('boot-container');
    if (bootContainer) {
        bootContainer.remove();
        logger.logEvent("info", "Bootloader UI jettisoned.");
    }
    // Clean up any residual bootloader styles from the body
    document.body.style = "";
    // --- HANDOVER COMPLETE ---

    const bodyTemplate = await Storage.getArtifactContent('/modules/ui-body-template.html');
    const styleContent = await Storage.getArtifactContent('/modules/ui-style.css');
    
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
        if(bodyTemplate) appRoot.innerHTML = bodyTemplate;
        appRoot.style.display = 'block'; // Make sure the agent's root is visible.
    }
    
    if (styleContent) {
        const styleEl = document.createElement('style');
        styleEl.id = 'agent-styles'; // Give it an ID for potential self-modification
        styleEl.textContent = styleContent;
        document.head.appendChild(styleEl);
    }
    
    initializeUIElementReferences();
    await updateStateDisplay();
    setupEventListeners();
    logger.logEvent("info", "Agent UI Initialized. Standing by.");
  };

  return {
    init,
    updateStatus,
    logToTimeline,
    updateStateDisplay,
    displayCycleArtifact,
    clearCurrentCycleDetails,
    setRunButtonState,
    showHumanInterventionUI,
  };
};