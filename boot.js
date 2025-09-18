// New boot script for persona-based onboarding

(async () => {
    const state = {
        config: null,
        strings: null,
        selectedPersonaId: null,
        isAdvancedMode: false,
    };

    const elements = {
        personaContainer: document.getElementById('persona-selection-container'),
        goalInput: document.getElementById('goal-input'),
        awakenBtn: document.getElementById('awaken-btn'),
        advancedToggle: document.getElementById('advanced-toggle'),
        advancedContainer: document.getElementById('advanced-options'),
        onboardingTitle: document.getElementById('onboarding-title'),
        advancedModeLabel: document.getElementById('advanced-mode-label'),
    };

    async function fetchJSON(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${url}`);
        return response.json();
    }

    function renderPersonas() {
        elements.personaContainer.innerHTML = '';
        state.config.personas.forEach(persona => {
            const card = document.createElement('div');
            card.className = 'persona-card';
            card.dataset.id = persona.id;
            card.innerHTML = `
                <h3>${persona.name}</h3>
                <p>${persona.description}</p>
            `;
            card.addEventListener('click', () => selectPersona(persona.id));
            elements.personaContainer.appendChild(card);
        });
    }

    function selectPersona(personaId) {
        state.selectedPersonaId = personaId;
        
        // Update UI
        document.querySelectorAll('.persona-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.id === personaId);
        });

        elements.goalInput.disabled = false;
        elements.awakenBtn.disabled = false;
        elements.goalInput.focus();
    }

    function toggleAdvancedMode(isAdvanced) {
        state.isAdvancedMode = isAdvanced;
        elements.advancedContainer.classList.toggle('hidden', !isAdvanced);
        elements.personaContainer.classList.toggle('hidden', isAdvanced);
        
        // In a real implementation, we would render the old wizard UI here
        if (isAdvanced) {
            elements.advancedContainer.innerHTML = '<p>Advanced configuration UI for selecting individual upgrades and blueprints would be rendered here.</p>';
        }
    }

    async function awakenAgent() {
        if (!state.selectedPersonaId && !state.isAdvancedMode) {
            alert('Please select a Persona first.');
            return;
        }

        const goal = elements.goalInput.value;
        if (!goal) {
            alert('Please define a goal for the agent.');
            return;
        }

        console.log('Awakening agent with:');
        if (state.isAdvancedMode) {
            console.log('Mode: Advanced');
            // Logic to get selected upgrades/blueprints from advanced UI
        } else {
            const persona = state.config.personas.find(p => p.id === state.selectedPersonaId);
            console.log('Persona:', persona.name);
            console.log('Goal:', goal);
            console.log('Upgrades:', persona.upgrades);
            console.log('Blueprints:', persona.blueprints);
        }
        
        // Hide boot UI and show app root
        document.getElementById('boot-container').style.display = 'none';
        document.getElementById('app-root').style.display = 'block';

        // Here, the original logic to initialize the VFS and hand off to app-logic.js would run.
        // This is a placeholder for that complex process.
        document.getElementById('app-root').innerHTML = '<h1>Agent is Awakening...</h1><p>(Full dashboard UI would be rendered here)</p>';
    }

    async function initialize() {
        try {
            [state.config, state.strings] = await Promise.all([
                fetchJSON('config.json'),
                fetchJSON('data/strings.json')
            ]);

            // Populate UI with strings
            elements.onboardingTitle.textContent = state.strings.onboarding_title;
            elements.advancedModeLabel.textContent = state.strings.advanced_mode_label;
            elements.goalInput.placeholder = state.strings.goal_input_placeholder;
            elements.awakenBtn.textContent = state.strings.awaken_button;

            renderPersonas();

            // Setup event listeners
            elements.advancedToggle.addEventListener('change', (e) => toggleAdvancedMode(e.target.checked));
            elements.awakenBtn.addEventListener('click', awakenAgent);
            elements.goalInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') awakenAgent();
            });

        } catch (error) {
            document.body.innerHTML = `<p style="color:red;">Fatal Error during boot: ${error.message}. Please check the console.</p>`;
            console.error(error);
        }
    }

    initialize();
})();
