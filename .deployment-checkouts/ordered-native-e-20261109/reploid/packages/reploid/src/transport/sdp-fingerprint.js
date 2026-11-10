export const fingerprint = description => {
  const values = [...new Set((description?.sdp || '').split(/\r?\n/)
    .filter(line => /^a=fingerprint:sha-256 /i.test(line)).map(line => line.slice(14).trim().toLowerCase()))];
  return values.length === 1 && /^sha-256 (?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/.test(values[0]) ? values[0] : null;
};
