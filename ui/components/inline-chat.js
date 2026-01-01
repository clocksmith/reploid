/**
 * @fileoverview Inline Chat - Human-in-the-loop message input
 * Allows humans to inject messages into agent context during execution.
 */

const InlineChat = {
  metadata: {
    id: 'InlineChat',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    let _container = null;
    let _input = null;

    const init = (containerId) => {
      _container = typeof containerId === 'string'
        ? document.getElementById(containerId)
        : containerId;

      if (!_container) {
        logger.warn('[InlineChat] Container not found');
        return false;
      }

      render();
      bindEvents();
      logger.info('[InlineChat] Initialized');
      return true;
    };

    const render = () => {
      if (!_container) return;

      const html = `
        <div class="inline-chat">
          <div class="inline-chat-input-row">
            <input
              type="text"
              class="inline-chat-input"
              placeholder="Type a message to inject into agent context..."
              autocomplete="off"
            />
            <button class="inline-chat-send" title="Send (Enter)">
              &#x27A4;
            </button>
          </div>
        </div>
      `;

      _container.innerHTML = html;
      _input = _container.querySelector('.inline-chat-input');
    };

    const bindEvents = () => {
      if (!_container) {
        logger.warn('[InlineChat] Cannot bind events - container not found');
        return;
      }

      // Send button - bind directly to button element
      const sendBtn = _container.querySelector('.inline-chat-send');
      if (sendBtn) {
        sendBtn.addEventListener('click', (e) => {
          e.preventDefault();
          sendMessage();
        });
      }

      // Enter key to send
      if (_input) {
        _input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });
      }
    };

    const sendMessage = () => {
      // Use cached _input reference first, fall back to query
      const input = _input || _container?.querySelector('.inline-chat-input');
      if (!input) {
        return;
      }

      const content = input.value.trim();
      if (!content) return;

      // Clear input immediately for better UX
      input.value = '';

      try {
        // Emit event for AgentLoop to pick up
        if (EventBus?.emit) {
          EventBus.emit('human:message', {
            content,
            type: 'context',
            timestamp: Date.now()
          });

          // Show immediate feedback in history
          EventBus.emit('agent:history', {
            type: 'human',
            cycle: '-',
            content: content,
            messageType: 'context',
            pending: true
          });
        }
      } catch (e) {
        logger.error('[InlineChat] Error emitting events:', e);
      }

      logger?.info?.(`[InlineChat] Sent message: ${content.substring(0, 50)}...`);

      // Visual feedback on send button
      const sendBtn = _container?.querySelector('.inline-chat-send');
      if (sendBtn) {
        sendBtn.textContent = '✓';
        sendBtn.classList.add('sent');
        setTimeout(() => {
          sendBtn.innerHTML = '&#x27A4;';
          sendBtn.classList.remove('sent');
        }, 1000);
      }

      input.focus();
    };

    const focus = () => {
      const input = _container?.querySelector('.inline-chat-input');
      if (input) input.focus();
    };

    const cleanup = () => {
      _container = null;
      _input = null;
    };

    return {
      init,
      render,
      focus,
      cleanup
    };
  }
};

export default InlineChat;
