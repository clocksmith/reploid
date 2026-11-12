// Dispatches one JSON request through an Express pool router in process, with a fixed loopback
// client address and no request headers. Resolves { status, body }; an unmatched route resolves 404.
// Route tests that vary the client address or headers keep their own harness.
export const dispatchJson = async (router, path, { method = 'GET', body = null } = {}) => {
  const url = new URL(path, 'http://reploid.test');
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {},
      body,
      ip: '127.0.0.1'
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      getHeader(name) { return this.headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      end(payload) { resolve({ status: this.statusCode, body: payload || null }); return this; }
    };
    router.handle(req, res, (error) => error ? reject(error) : resolve({ status: 404, body: {} }));
  });
};
