export const tool = {
  name: 'AwakenChild',
  description: 'Awakens the child agent by clicking the button and sending init message',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Goal to set' },
      depth: { type: 'number', description: 'Depth' }
    },
    required: ['goal', 'depth']
  }
};

export default async function(args, deps) {
  const { goal, depth } = args;
  const container = document.getElementById('recursive-container');
  if (!container) return 'Container not found';
  
  const iframe = container.querySelector('iframe');
  if (!iframe) return 'Iframe not found';
  
  const childDoc = iframe.contentDocument || iframe.contentWindow.document;
  
  // 1. Click Awaken Button
  const btn = childDoc.getElementById('awaken-btn');
  if (btn) {
    btn.click();
    console.log('[AwakenChild] Clicked Awaken button');
  } else {
    console.log('[AwakenChild] Awaken button not found (already booted?)');
  }
  
  // 2. Wait for proto.js to load
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      const goalEl = iframe.contentDocument.getElementById('agent-goal');
      if (goalEl || attempts > 20) {
        clearInterval(interval);
        
        // 3. Send Message
        console.log('[AwakenChild] Sending INIT_RECURSION');
        iframe.contentWindow.postMessage({
          type: 'INIT_RECURSION',
          goal: goal,
          depth: depth
        }, '*');
        
        resolve(`Awakened child. Goal element found: ${!!goalEl}. Message sent.`);
      }
      attempts++;
    }, 500);
  });
}
