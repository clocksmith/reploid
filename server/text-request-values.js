// Leaf helpers shared by the text requester and its request-option parser, so neither imports the other for them.

export const fail = (status, message, param = null) => Object.assign(new Error(message), { status, param });
export const assert = (ok, message) => { if (!ok) throw fail(502, message); };
export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const freeze = value => { if (object(value) || Array.isArray(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
