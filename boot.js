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

    function showBootMessage(message, type = 'info') {
        // Create inline message instead of alert()
        const existingMsg = document.querySelector('.boot-message');
        if (existingMsg) existingMsg.remove();

        const msg = document.createElement('div');
        msg.className = `boot-message boot-message-${type}`;
        msg.textContent = message;
        msg.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: slideDown 0.3s ease-out;
            ${type === 'warning' ? 'background: rgba(255, 215, 0, 0.9); color: #000;' :
              type === 'error' ? 'background: rgba(244, 135, 113, 0.9); color: white;' :
              'background: rgba(79, 195, 247, 0.9); color: white;'}
        `;

        document.body.appendChild(msg);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            msg.style.animation = 'slideUp 0.3s ease-out';
            setTimeout(() => msg.remove(), 300);
        }, 3000);
    }

    function renderPersonas() {
        elements.personaContainer.innerHTML = '';
        state.config.personas.forEach(persona => {
            const card = document.createElement('div');
            card.className = 'persona-card';
            card.dataset.id = persona.id;
            
            // Add type badge for Lab or Factory
            const typeBadge = persona.type ? `<span class="persona-type-badge ${persona.type}">${persona.type.toUpperCase()}</span>` : '';
            
            card.innerHTML = `
                <h3>${persona.name} ${typeBadge}</h3>
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
        
        // If it's a lab persona with lessons, show lesson selector
        const persona = state.config.personas.find(p => p.id === personaId);
        if (persona.type === 'lab' && persona.lessons && persona.lessons.length > 0) {
            renderLessons(persona.lessons);
        } else {
            hideLessons();
        }
        
        elements.goalInput.focus();
    }
    
    function renderLessons(lessons) {
        let lessonContainer = document.getElementById('lesson-container');
        if (!lessonContainer) {
            lessonContainer = document.createElement('div');
            lessonContainer.id = 'lesson-container';
            lessonContainer.className = 'lesson-container';
            elements.goalInput.parentElement.insertBefore(lessonContainer, elements.goalInput);
        }
        
        lessonContainer.innerHTML = '<h4>Quick Start Lessons:</h4>';
        const lessonList = document.createElement('div');
        lessonList.className = 'lesson-list';
        
        lessons.forEach(lesson => {
            const lessonBtn = document.createElement('button');
            lessonBtn.className = 'lesson-btn';
            lessonBtn.textContent = lesson.name;
            lessonBtn.addEventListener('click', () => {
                elements.goalInput.value = lesson.goal;
                elements.goalInput.focus();
            });
            lessonList.appendChild(lessonBtn);
        });
        
        lessonContainer.appendChild(lessonList);
    }
    
    function hideLessons() {
        const lessonContainer = document.getElementById('lesson-container');
        if (lessonContainer) {
            lessonContainer.remove();
        }
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

    function sanitizeGoal(goal) {
        // Security: Sanitize goal input
        // 1. Trim whitespace
        // 2. Strip HTML tags
        // 3. Limit length (enforced by HTML maxlength, but double-check)
        const trimmed = goal.trim();
        const noHtml = trimmed.replace(/<[^>]*>/g, '');
        const limited = noHtml.slice(0, 500);
        return limited;
    }

    async function awakenAgent() {
        if (!state.selectedPersonaId && !state.isAdvancedMode) {
            showBootMessage('Please select a Persona first.', 'warning');
            return;
        }

        const rawGoal = elements.goalInput.value;
        if (!rawGoal) {
            showBootMessage('Please define a goal for the agent.', 'warning');
            return;
        }

        // Sanitize goal input for security
        const goal = sanitizeGoal(rawGoal);

        console.log('Awakening agent with:');
        let bootConfig;
        if (state.isAdvancedMode) {
            console.log('Mode: Advanced');
            // Logic to get selected upgrades/blueprints from advanced UI
            bootConfig = {
                mode: 'advanced',
                goal: goal,
                // Additional config from advanced UI would go here
            };
        } else {
            const persona = state.config.personas.find(p => p.id === state.selectedPersonaId);
            console.log('Persona:', persona.name);
            console.log('Persona Type:', persona.type);
            console.log('Goal:', goal);
            console.log('Upgrades:', persona.upgrades);
            console.log('Blueprints:', persona.blueprints);
            
            bootConfig = {
                mode: 'persona',
                persona: persona,
                goal: goal,
                previewTarget: persona.previewTarget || null,
            };
        }
        
        // Store boot config for the main app to access
        window.REPLOID_BOOT_CONFIG = bootConfig;
        
        // Initialize the VFS and start the main application
        await initializeReploidApplication(bootConfig);
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

    // Initialize the Virtual File System and load modules
    async function initializeReploidApplication(bootConfig) {
        try {
            // Load DiffGenerator utility first
            const diffGenScript = document.createElement('script');
            diffGenScript.src = 'utils/diff-generator.js';
            document.head.appendChild(diffGenScript);
            await new Promise((resolve) => {
                diffGenScript.onload = resolve;
                diffGenScript.onerror = () => {
                    console.warn('Failed to load diff-generator.js');
                    // Create a stub so UI doesn't break
                    window.DiffGenerator = {
                        createDiff: (old, new) => []
                    };
                    resolve();
                };
            });
            
            // Create a simple VFS interface
            const vfs = {
                read: async (path) => {
                    // Remove leading /modules/ from path for fetching
                    const cleanPath = path.replace(/^\/modules\//, 'upgrades/');
                    try {
                        const response = await fetch(cleanPath);
                        if (!response.ok) return null;
                        return await response.text();
                    } catch (e) {
                        console.warn(`Failed to read ${path}:`, e);
                        return null;
                    }
                },
                exists: async (path) => {
                    const content = await vfs.read(path);
                    return content !== null;
                }
            };

            // Store boot config for the app to access
            window.REPLOID_VFS = vfs;
            window.REPLOID_CONFIG = state.config;
            
            // Load and execute the main application logic
            const appLogicPath = '/modules/app-logic.js';
            const appLogicContent = await vfs.read(appLogicPath);
            
            if (!appLogicContent) {
                throw new Error('Failed to load app-logic.js');
            }
            
            // Execute the CoreLogicModule
            await (new Function(
                'initialConfig',
                'vfs',
                appLogicContent + '\nawait CoreLogicModule(initialConfig, vfs);'
            ))(state.config, vfs);
            
            console.log('Application initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize application:', error);
            document.getElementById('app-root').innerHTML = 
                `<div style="padding: 20px; color: red;">
                    <h2>Initialization Error</h2>
                    <p>${error.message}</p>
                    <p>Please check the console for more details.</p>
                </div>`;
        }
    }
    
    initialize();
})();
