// Substrate Tools - Give the agent the ability to load code into the running system
// These tools enable TRUE RSI by allowing the agent to modify its own substrate

export default {
  metadata: {
    name: 'SubstrateTools',
    version: '1.0.0'
  },

  registerTools: (toolRunner, substrateLoader) => {
    // Load a module from VFS into the running substrate
    toolRunner.registerBuiltIn('load_module', async (args) => {
      const { path } = args;
      if (!path) {
        throw new Error('Missing required argument: path');
      }

      const result = await substrateLoader.loadModule(path);
      return {
        success: true,
        path,
        message: `Module loaded: ${path}`,
        hasInit: !!result.module?.init,
        hasFactory: !!result.module?.factory
      };
    });

    // Load a widget into the dashboard
    toolRunner.registerBuiltIn('load_widget', async (args) => {
      const { path, containerId, containerStyle } = args;
      if (!path) {
        throw new Error('Missing required argument: path');
      }

      const result = await substrateLoader.loadWidget(path, containerId || `widget-${Date.now()}`, {
        containerStyle: containerStyle || 'padding: 20px; border: 1px solid #333; margin: 10px; border-radius: 5px;'
      });

      return {
        success: true,
        path,
        containerId: result.container.id,
        message: `Widget loaded and mounted: ${path}`
      };
    });

    // Update Live Preview panel with HTML content
    toolRunner.registerBuiltIn('update_preview', async (args) => {
      const { html, css, js } = args;
      if (!html) {
        throw new Error('Missing required argument: html');
      }

      const previewContent = document.getElementById('preview-content');
      if (!previewContent) {
        throw new Error('Live Preview panel not found in DOM');
      }

      // Clear existing content
      previewContent.innerHTML = '';

      // Add CSS if provided
      if (css) {
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        previewContent.appendChild(styleEl);
      }

      // Add HTML
      const contentDiv = document.createElement('div');
      contentDiv.innerHTML = html;
      previewContent.appendChild(contentDiv);

      // Execute JS if provided
      if (js) {
        try {
          const fn = new Function(js);
          fn();
        } catch (error) {
          console.error('[SubstrateTools] Preview JS error:', error);
          throw new Error(`Preview JavaScript execution failed: ${error.message}`);
        }
      }

      return {
        success: true,
        message: 'Live Preview updated',
        htmlLength: html.length,
        hasCSS: !!css,
        hasJS: !!js
      };
    });

    // Create a custom widget from HTML/CSS/JS (simple DOM injection)
    toolRunner.registerBuiltIn('create_widget', async (args) => {
      const { name, html, css, js } = args;
      if (!name || !html) {
        throw new Error('Missing required arguments: name, html');
      }

      // First, save the widget code to VFS so it persists
      const widgetCode = `// Widget: ${name}
export default {
  name: '${name}',
  html: \`${html.replace(/`/g, '\\`')}\`,
  css: \`${(css || '').replace(/`/g, '\\`')}\`,
  js: \`${(js || '').replace(/`/g, '\\`')}\`,

  render: (containerId) => {
    const container = document.getElementById(containerId) || document.getElementById('chat-container');

    // Create widget container
    const widgetDiv = document.createElement('div');
    widgetDiv.id = 'widget-${name}';
    widgetDiv.innerHTML = \`
      <style>\${this.css}</style>
      \${this.html}
    \`;

    container.appendChild(widgetDiv);

    // Execute JS if provided
    if (this.js) {
      try {
        const fn = new Function(this.js);
        fn();
      } catch (error) {
        console.error('[Widget:${name}] JS execution error:', error);
      }
    }

    return widgetDiv;
  }
};`;

      // Save to VFS
      const widgetPath = `/widgets/${name}.js`;
      const deps = { vfs: window.REPLOID.vfs };
      await deps.vfs.write(widgetPath, widgetCode);

      console.log(`[SubstrateTools] Widget saved to VFS: ${widgetPath}`);

      // Now create and inject it into DOM
      const result = await substrateLoader.createWidget(
        name,
        html,
        css || '',
        js || ''
      );

      // Log widget creation to disk logger if available
      if (window.REPLOID?.diskLogger) {
        await window.REPLOID.diskLogger.logWidgetCreation(name, widgetPath);
      }

      return {
        success: true,
        name,
        path: widgetPath,
        containerId: result.container.id,
        message: `Widget created, saved to VFS, and loaded: ${name}`,
        persisted: true
      };
    });

    // Create a Web Component with Shadow DOM (advanced)
    toolRunner.registerBuiltIn('create_web_component', async (args) => {
      const { name, html, css, js } = args;
      if (!name || !html) {
        throw new Error('Missing required arguments: name, html');
      }

      // Generate Web Component class
      const componentCode = `
// Web Component: ${name}
class ${name.charAt(0).toUpperCase() + name.slice(1)}Component extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = \`
      <style>${css || ''}</style>
      ${html}
    \`;

    // Execute component JS
    ${js || ''}
  }
}

customElements.define('${name}', ${name.charAt(0).toUpperCase() + name.slice(1)}Component);

export default ${name.charAt(0).toUpperCase() + name.slice(1)}Component;
`;

      // Save to VFS
      const deps = { vfs: window.REPLOID.vfs };
      await deps.vfs.write(`/components/${name}.js`, componentCode);

      // Load and register the component
      await substrateLoader.loadModule(`/components/${name}.js`);

      // Create instance in DOM
      const container = document.getElementById('chat-container');
      const element = document.createElement(name);
      element.id = `component-${name}`;
      container.appendChild(element);

      return {
        success: true,
        name,
        path: `/components/${name}.js`,
        tagName: name,
        message: `Web Component created and registered: <${name}>`
      };
    });

    // Execute arbitrary code in the substrate (use with caution)
    toolRunner.registerBuiltIn('execute_substrate_code', async (args) => {
      const { code } = args;
      if (!code) {
        throw new Error('Missing required argument: code');
      }

      const result = await substrateLoader.executeCode(code);

      return {
        success: true,
        result: typeof result === 'object' ? JSON.stringify(result) : String(result),
        message: 'Code executed in substrate'
      };
    });

    // Inject a new tool directly into the system
    toolRunner.registerBuiltIn('inject_tool', async (args) => {
      const { name, code } = args;
      if (!name || !code) {
        throw new Error('Missing required arguments: name, code');
      }

      const result = await substrateLoader.injectTool(name, code);

      return {
        success: true,
        name,
        registered: result.registered,
        message: `Tool injected and registered: ${name}`
      };
    });

    // Reload a module (hot reload)
    toolRunner.registerBuiltIn('reload_module', async (args) => {
      const { path } = args;
      if (!path) {
        throw new Error('Missing required argument: path');
      }

      const result = await substrateLoader.reload(path);

      return {
        success: true,
        path,
        message: `Module reloaded: ${path}`
      };
    });

    // Unload a module or widget
    toolRunner.registerBuiltIn('unload_module', async (args) => {
      const { path } = args;
      if (!path) {
        throw new Error('Missing required argument: path');
      }

      substrateLoader.unload(path);

      return {
        success: true,
        path,
        message: `Module unloaded: ${path}`
      };
    });

    // List all loaded modules and widgets
    toolRunner.registerBuiltIn('list_loaded_modules', async (args) => {
      const result = substrateLoader.listLoaded();

      return {
        modules: result.modules,
        widgets: result.widgets,
        totalModules: result.modules.length,
        totalWidgets: result.widgets.length
      };
    });

    // Load code as an iframe sandbox
    toolRunner.registerBuiltIn('load_iframe', async (args) => {
      const { path, containerId, containerStyle, iframeStyle } = args;
      if (!path) {
        throw new Error('Missing required argument: path');
      }

      const result = await substrateLoader.loadIframe(path, containerId || `iframe-${Date.now()}`, {
        containerStyle: containerStyle || 'width: 100%; height: 400px; margin: 10px;',
        iframeStyle: iframeStyle || 'width: 100%; height: 100%; border: 1px solid #333;'
      });

      return {
        success: true,
        path,
        containerId: result.container.id,
        message: `Iframe loaded: ${path}`
      };
    });

    console.log('[SubstrateTools] Registered 11 substrate manipulation tools');

    return {
      toolsRegistered: 11,
      tools: [
        'load_module',
        'load_widget',
        'update_preview',
        'create_widget',
        'create_web_component',
        'execute_substrate_code',
        'inject_tool',
        'reload_module',
        'unload_module',
        'list_loaded_modules',
        'load_iframe'
      ]
    };
  }
};
