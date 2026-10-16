/** Shared exact-field mechanics; callers retain domain error types and policy. */
export const createKnownKeyValidator = fail => (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter(key => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

export const collectUnknownKeys = (value, allowed, label, errors) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
  }
};
