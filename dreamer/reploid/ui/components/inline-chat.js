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
        console.warn('[InlineChat] Cannot bind events - container not found');
        return;
      }

      // Send button
      _container.addEventListener('click', (e) => {
        if (e.target.closest('.inline-chat-send')) {
          sendMessage();
        }
      });

      // Enter key to send
      if (_input) {
        _input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });
        console.log('[InlineChat] Events bound to input');
      } else {
        console.warn('[InlineChat] Input not found when binding events');
      }
    };

    const sendMessage = () => {
      if (!_input) {
        console.warn('[InlineChat] Input not found');
        return;
      }

      const content = _input.value.trim();
      if (!content) return;

      // Clear input immediately for better UX
      _input.value = '';

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
        } else {
          console.warn('[InlineChat] EventBus not available');
        }
      } catch (e) {
        console.error('[InlineChat] Error emitting events:', e);
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

      _input.focus();
    };

    const focus = () => {
      if (_input) _input.focus();
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

// CSS styles - using cyan (#00bcd4) for consistency with REPLOID theme
const INLINE_CHAT_STYLES = `
.inline-chat {
  background: rgba(0, 0, 0, 0.4);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 8px 12px;
}

.inline-chat-input-row {
  display: flex;
  gap: 8px;
}

.inline-chat-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 8px 12px;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}

.inline-chat-input:focus {
  border-color: rgba(0, 188, 212, 0.5);
}

.inline-chat-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.inline-chat-send {
  background: rgba(0, 188, 212, 0.2);
  border: 1px solid rgba(0, 188, 212, 0.3);
  color: #00bcd4;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.inline-chat-send:hover {
  background: rgba(0, 188, 212, 0.3);
  border-color: rgba(0, 188, 212, 0.5);
}

.inline-chat-send:active {
  transform: scale(0.95);
}

.inline-chat-send.sent {
  background: rgba(102, 187, 106, 0.3);
  border-color: rgba(102, 187, 106, 0.5);
  color: #66bb6a;
}

/* Human message display in history */
.history-entry.human-message {
  background: rgba(0, 188, 212, 0.1);
  border-left: 3px solid #00bcd4;
}

.history-entry.human-message .entry-label {
  color: #00bcd4;
}

/* Approval prompt in history */
.history-entry.approval-pending {
  background: rgba(255, 165, 0, 0.15);
  border-left: 3px solid #ffa500;
  padding: 12px;
}

.approval-header {
  font-weight: 600;
  color: #ffa500;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.approval-action {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 8px;
}

.approval-data {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  padding: 8px;
  font-size: 11px;
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 10px;
  white-space: pre-wrap;
  word-break: break-all;
}

.approval-buttons {
  display: flex;
  gap: 8px;
}

.approval-buttons button {
  flex: 1;
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.approval-buttons .approve-btn {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
  border: 1px solid rgba(102, 187, 106, 0.3);
}

.approval-buttons .approve-btn:hover {
  background: rgba(102, 187, 106, 0.3);
}

.approval-buttons .reject-btn {
  background: rgba(244, 135, 113, 0.2);
  color: #f48771;
  border: 1px solid rgba(244, 135, 113, 0.3);
}

.approval-buttons .reject-btn:hover {
  background: rgba(244, 135, 113, 0.3);
}

.approval-resolved {
  opacity: 0.5;
  pointer-events: none;
}

.approval-resolved .approval-buttons {
  display: none;
}

.approval-resolved::after {
  content: attr(data-resolution);
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
`;

export default InlineChat;
export { INLINE_CHAT_STYLES };
