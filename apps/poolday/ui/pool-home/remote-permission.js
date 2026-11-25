/** Network-answer settings and retained permission-record wording.
 * The host stores and enforces authorization; this view reports the person's choice. */

const WHO = {
  'ordered-partition-activations-and-tokens': 'The first computer receives the text. The other computers receive the same content as model tokens, which read back as text, plus intermediate results.',
  'partition-activations-and-tokens': 'The first computer receives the text. The second receives the same content as model tokens, which read back as text, plus intermediate results.',
  public: 'One computer receives the text and returns the answer.'
};

/** Identifies the wording below in each permission record; change the version whenever the text changes. */
export const REMOTE_PERMISSION_WORDING = Object.freeze({ id: 'reploid.remote-contributor-permission', version: '1' });

export function remotePermissionText(need) {
  return { title: "Answer with contributors' computers?",
    what: "To answer, this conversation is sent to contributors' computers on this network: your message, earlier messages in the thread, and the context prompt when it is on.",
    who: WHO[need.disclosure] || WHO.public,
    scope: 'You are asked once. Later questions and follow-ups are sent the same way until you turn this off in Settings.' };
}

/** Retained wording for permission records; the current conversation uses Settings. */
export function remotePermissionWording(need) {
  const text = remotePermissionText(need);
  return { ...REMOTE_PERMISSION_WORDING, text: ['title', 'what', 'who', 'scope'].map(key => text[key]).join('\n\n') };
}
