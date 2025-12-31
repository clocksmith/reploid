/**
 * @fileoverview Cognition Panel
 * Visualizes the knowledge graph and semantic memory stats.
 */

const CognitionPanel = {
  metadata: {
    id: 'CognitionPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'CognitionAPI?', 'KnowledgeGraph?', 'SemanticMemory?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, CognitionAPI, KnowledgeGraph, SemanticMemory } = deps;
    const { logger } = Utils;

    let _container = null;
    let _canvas = null;
    let _ctx = null;
    let _animationId = null;

    // Graph visualization state
    let _nodes = [];
    let _edges = [];
    let _selectedNode = null;
    let _hoveredNode = null;
    let _transform = { x: 0, y: 0, scale: 1 };

    // Read CSS variables from DOM for canvas rendering (rd.css compliance)
    const getColors = () => {
      const styles = getComputedStyle(document.documentElement);
      const fg = styles.getPropertyValue('--fg').trim() || '#000000';
      const bg = styles.getPropertyValue('--bg').trim() || '#FFFFFF';
      const opacityMuted = parseFloat(styles.getPropertyValue('--opacity-muted')) || 0.5;
      const opacitySecondary = parseFloat(styles.getPropertyValue('--opacity-secondary')) || 0.6;
      const opacityGhost = parseFloat(styles.getPropertyValue('--opacity-ghost')) || 0.7;

      // Convert hex to rgba for opacity variations
      const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };

      return {
        fg,
        bg,
        // Node types use fg with different opacities (no semantic colors)
        Entity: hexToRgba(fg, opacityGhost),
        Tool: hexToRgba(fg, 0.8),
        File: hexToRgba(fg, opacitySecondary),
        Error: fg,  // full opacity with dashed rendering
        CodeElement: hexToRgba(fg, 0.75),
        URL: hexToRgba(fg, opacityMuted),
        default: hexToRgba(fg, opacityMuted),
        edge: hexToRgba(fg, 0.25),
        selected: fg,
        hovered: fg
      };
    };

    const CONFIG = {
      nodeRadius: 15,
      edgeWidth: 1.5,
      repulsion: 300,
      attraction: 0.03,
      damping: 0.85
    };

    let _colors = null;

    const init = (containerId) => {
      _container = document.getElementById(containerId);
      if (!_container) {
        logger.warn('[CognitionPanel] Container not found');
        return;
      }

      // Initialize colors from CSS variables
      _colors = getColors();

      render();
      setupEventListeners();
      loadGraphData();
      startAnimation();

      logger.info('[CognitionPanel] Initialized');
    };

    const render = () => {
      _container.innerHTML = `
        <div class="cognition-panel">
          <div class="cognition-header">
            <h4>Neurosymbolic Cognition</h4>
            <div class="cognition-controls">
              <button id="cog-refresh-btn" class="btn small" title="Refresh">Refresh</button>
              <button id="cog-infer-btn" class="btn small" title="Run Inference">Infer</button>
              <button id="cog-clear-btn" class="btn small danger" title="Clear All">Clear</button>
            </div>
          </div>

          <div class="cognition-stats" id="cog-stats">
            <div class="stat-row">
              <span class="stat-label">Entities:</span>
              <span class="stat-value" id="cog-entities">0</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Relations:</span>
              <span class="stat-value" id="cog-relations">0</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Memories:</span>
              <span class="stat-value" id="cog-memories">0</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Rules:</span>
              <span class="stat-value" id="cog-rules">0</span>
            </div>
          </div>

          <div class="cognition-graph-container">
            <canvas id="cog-graph-canvas" width="400" height="300"></canvas>
          </div>

          <div class="cognition-search">
            <input type="text" id="cog-search" placeholder="Search entities..." />
          </div>

          <div class="cognition-info" id="cog-info">
            <p class="empty-state">Select an entity to view details</p>
          </div>
        </div>
      `;

      _canvas = document.getElementById('cog-graph-canvas');
      if (_canvas) {
        _ctx = _canvas.getContext('2d');
        resizeCanvas();
      }
    };

    const setupEventListeners = () => {
      const refreshBtn = document.getElementById('cog-refresh-btn');
      const inferBtn = document.getElementById('cog-infer-btn');
      const clearBtn = document.getElementById('cog-clear-btn');
      const searchInput = document.getElementById('cog-search');

      if (refreshBtn) {
        refreshBtn.onclick = loadGraphData;
      }

      if (inferBtn) {
        inferBtn.onclick = async () => {
          if (CognitionAPI?.symbolic?.infer) {
            inferBtn.disabled = true;
            inferBtn.textContent = 'Running...';
            try {
              await CognitionAPI.symbolic.infer();
              await loadGraphData();
            } finally {
              inferBtn.disabled = false;
              inferBtn.textContent = 'Infer';
            }
          }
        };
      }

      if (clearBtn) {
        clearBtn.onclick = async () => {
          if (confirm('Clear all cognition data?')) {
            if (KnowledgeGraph?.clear) await KnowledgeGraph.clear();
            if (SemanticMemory?.clear) await SemanticMemory.clear();
            await loadGraphData();
          }
        };
      }

      if (searchInput) {
        searchInput.oninput = (e) => {
          const query = e.target.value.toLowerCase();
          highlightMatchingNodes(query);
        };
      }

      if (_canvas) {
        _canvas.addEventListener('mousemove', handleMouseMove);
        _canvas.addEventListener('click', handleClick);
        _canvas.addEventListener('wheel', handleWheel);
      }

      // Listen for cognition events
      EventBus.on('cognition:symbolic:add', loadGraphData);
      EventBus.on('cognition:learning:extract', loadGraphData);

      // Handle resize
      window.addEventListener('resize', resizeCanvas);
    };

    const resizeCanvas = () => {
      if (!_canvas || !_container) return;
      const rect = _container.querySelector('.cognition-graph-container')?.getBoundingClientRect();
      if (rect) {
        _canvas.width = rect.width || 400;
        _canvas.height = rect.height || 300;
      }
    };

    const loadGraphData = async () => {
      _nodes = [];
      _edges = [];

      try {
        // Load entities
        if (KnowledgeGraph?.getAllEntities) {
          const entities = KnowledgeGraph.getAllEntities();
          const nodeMap = new Map();

          entities.forEach((entity, idx) => {
            const angle = (2 * Math.PI * idx) / Math.max(entities.length, 1);
            const radius = Math.min(_canvas?.width || 200, _canvas?.height || 200) * 0.3;
            const node = {
              id: entity.id,
              label: entity.labels?.en || entity.id,
              type: entity.types?.[0] || 'Entity',
              x: (_canvas?.width || 400) / 2 + Math.cos(angle) * radius,
              y: (_canvas?.height || 300) / 2 + Math.sin(angle) * radius,
              vx: 0,
              vy: 0,
              data: entity
            };
            _nodes.push(node);
            nodeMap.set(entity.id, node);
          });

          // Load relations as edges
          if (KnowledgeGraph?.query) {
            const triples = KnowledgeGraph.query({});
            triples.forEach(triple => {
              const source = nodeMap.get(triple.subject);
              const target = nodeMap.get(triple.object);
              if (source && target) {
                _edges.push({
                  source,
                  target,
                  predicate: triple.predicate,
                  confidence: triple.metadata?.confidence || 1
                });
              }
            });
          }
        }

        updateStats();
      } catch (e) {
        logger.warn('[CognitionPanel] Failed to load graph data:', e.message);
      }
    };

    const updateStats = async () => {
      try {
        const kgStats = KnowledgeGraph?.getStats?.() || {};
        const smStats = await SemanticMemory?.getStats?.() || {};
        const cogStats = CognitionAPI?.getStatus?.() || {};

        document.getElementById('cog-entities').textContent = kgStats.entityCount || 0;
        document.getElementById('cog-relations').textContent = kgStats.tripleCount || 0;
        document.getElementById('cog-memories').textContent = smStats.memoryCount || 0;
        document.getElementById('cog-rules').textContent = kgStats.ruleCount || cogStats.rules || 0;
      } catch (e) {
        // Stats not available
      }
    };

    const startAnimation = () => {
      const animate = () => {
        if (!_ctx || !_canvas) return;

        applyForces();
        draw();

        _animationId = requestAnimationFrame(animate);
      };
      animate();
    };

    const applyForces = () => {
      // Repulsion between nodes
      for (let i = 0; i < _nodes.length; i++) {
        for (let j = i + 1; j < _nodes.length; j++) {
          const dx = _nodes[j].x - _nodes[i].x;
          const dy = _nodes[j].y - _nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          if (dist < 100) {
            const force = CONFIG.repulsion / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            _nodes[i].vx -= fx;
            _nodes[i].vy -= fy;
            _nodes[j].vx += fx;
            _nodes[j].vy += fy;
          }
        }
      }

      // Attraction along edges
      for (const edge of _edges) {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = dist * CONFIG.attraction;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        edge.source.vx += fx;
        edge.source.vy += fy;
        edge.target.vx -= fx;
        edge.target.vy -= fy;
      }

      // Center gravity
      const centerX = _canvas.width / 2;
      const centerY = _canvas.height / 2;

      for (const node of _nodes) {
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * 0.001;
        node.vy += dy * 0.001;

        // Apply velocity
        node.vx *= CONFIG.damping;
        node.vy *= CONFIG.damping;
        node.x += node.vx;
        node.y += node.vy;

        // Bounds
        const margin = CONFIG.nodeRadius + 5;
        node.x = Math.max(margin, Math.min(_canvas.width - margin, node.x));
        node.y = Math.max(margin, Math.min(_canvas.height - margin, node.y));
      }
    };

    const draw = () => {
      if (!_colors) _colors = getColors();

      _ctx.fillStyle = _colors.bg;
      _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

      // Draw edges
      for (const edge of _edges) {
        _ctx.beginPath();
        _ctx.moveTo(edge.source.x, edge.source.y);
        _ctx.lineTo(edge.target.x, edge.target.y);
        _ctx.strokeStyle = _colors.edge;
        _ctx.lineWidth = CONFIG.edgeWidth * (edge.confidence || 1);
        _ctx.stroke();
      }

      // Draw nodes
      for (const node of _nodes) {
        const isSelected = node === _selectedNode;
        const isHovered = node === _hoveredNode;
        const isError = node.type === 'Error';

        _ctx.beginPath();
        _ctx.arc(node.x, node.y, CONFIG.nodeRadius, 0, Math.PI * 2);
        _ctx.fillStyle = _colors[node.type] || _colors.default;
        _ctx.fill();

        // Border - use dashed for errors, solid otherwise
        _ctx.strokeStyle = _colors.fg;
        if (isSelected) {
          _ctx.lineWidth = 3;
          _ctx.setLineDash([]);
          _ctx.stroke();
        } else if (isHovered) {
          _ctx.lineWidth = 2;
          _ctx.setLineDash([]);
          _ctx.stroke();
        } else if (isError) {
          _ctx.lineWidth = 2;
          _ctx.setLineDash([4, 2]);
          _ctx.stroke();
          _ctx.setLineDash([]);
        }

        // Label
        _ctx.fillStyle = _colors.fg;
        _ctx.font = '10px var(--font-a, monospace)';
        _ctx.textAlign = 'center';
        _ctx.fillText(
          node.label.slice(0, 12),
          node.x,
          node.y + CONFIG.nodeRadius + 12
        );
      }

      // Empty state
      if (_nodes.length === 0) {
        _ctx.fillStyle = _colors.default;
        _ctx.font = '14px var(--font-a, monospace)';
        _ctx.textAlign = 'center';
        _ctx.fillText('No entities yet', _canvas.width / 2, _canvas.height / 2);
        _ctx.font = '11px var(--font-a, monospace)';
        _ctx.fillText('Knowledge will appear as you use the agent', _canvas.width / 2, _canvas.height / 2 + 20);
      }
    };

    const handleMouseMove = (e) => {
      const rect = _canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      _hoveredNode = null;
      for (const node of _nodes) {
        const dx = node.x - x;
        const dy = node.y - y;
        if (dx * dx + dy * dy < CONFIG.nodeRadius * CONFIG.nodeRadius) {
          _hoveredNode = node;
          _canvas.style.cursor = 'pointer';
          return;
        }
      }
      _canvas.style.cursor = 'default';
    };

    const handleClick = () => {
      _selectedNode = _hoveredNode;
      updateInfoPanel();
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      _transform.scale = Math.max(0.5, Math.min(2, _transform.scale * delta));
    };

    const updateInfoPanel = () => {
      const infoEl = document.getElementById('cog-info');
      if (!infoEl) return;

      if (!_selectedNode) {
        infoEl.innerHTML = '<p class="empty-state">Select an entity to view details</p>';
        return;
      }

      const entity = _selectedNode.data;
      const relations = _edges.filter(e =>
        e.source === _selectedNode || e.target === _selectedNode
      );

      infoEl.innerHTML = `
        <div class="entity-details">
          <h5>${entity.labels?.en || entity.id}</h5>
          <p><strong>Type:</strong> ${entity.types?.join(', ') || 'Entity'}</p>
          <p><strong>ID:</strong> <code>${entity.id}</code></p>
          <p><strong>Confidence:</strong> ${(entity.metadata?.confidence || 1).toFixed(2)}</p>
          <p><strong>Relations:</strong> ${relations.length}</p>
          ${relations.length > 0 ? `
            <ul class="relations-list">
              ${relations.slice(0, 5).map(r => {
                const other = r.source === _selectedNode ? r.target : r.source;
                const dir = r.source === _selectedNode ? '->' : '<-';
                return `<li>${dir} ${r.predicate} <code>${other.label}</code></li>`;
              }).join('')}
            </ul>
          ` : ''}
        </div>
      `;
    };

    const highlightMatchingNodes = (query) => {
      if (!query) {
        _nodes.forEach(n => n.highlighted = false);
        return;
      }

      _nodes.forEach(n => {
        n.highlighted = n.label.toLowerCase().includes(query) ||
                       n.id.toLowerCase().includes(query);
      });
    };

    const dispose = () => {
      if (_animationId) {
        cancelAnimationFrame(_animationId);
      }
      window.removeEventListener('resize', resizeCanvas);
      EventBus.off('cognition:symbolic:add', loadGraphData);
      EventBus.off('cognition:learning:extract', loadGraphData);
    };

    return { init, dispose, refresh: loadGraphData };
  }
};

export default CognitionPanel;
