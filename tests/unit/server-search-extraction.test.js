// @vitest-environment node
// Bounded server-side page fetch (server/search) and the HTML/plain-text extraction and passage offsets it shares
// with device-side extractors (retrieval library). A local node:http server stands in for cited pages; address checks
// are exercised with injected lookups.
import http from 'node:http';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPageFetcher, isBlockedAddress } from '../../server/search/page-fetch.js';
import { decodeEntities, extractDocumentText } from '../../packages/reploid/src/retrieval/page-text.js';
import { selectPassage } from '../../packages/reploid/src/retrieval/passage.js';

const PAGE = `<!doctype html><HTML><head><title>Eiffel &amp; Paris</title><style>p{color:red}</style>
<script>var x = "<p>not text</p>";</script></head>
<body><nav><a href="/">Home</a> <a href="/more">More</a></nav>
<header>Site banner</header>
<article><p>Short aside article.</p></article>
<main id="content" data-note="a > b">
  <h1>The Eiffel Tower</h1>
  <p>The tower was completed in <b>1889</b>&nbsp;for the Exposition&#160;Universelle &mdash; a world&#x27;s fair.</p>
  <!-- <p>commented out</p> -->
  <aside>Advertisement</aside>
  <ul><li>Height: 330 m</li><li>Designer: Gustave Eiffel&#39;s company</li></ul>
  <table><tr><td>Opened</td><td>1889</td></tr></table>
  <p>Unclosed paragraph with &unknown; entity
</main>
<footer>Copyright</footer><noscript>Enable JS</noscript></body></HTML>`;

let server, base;
const routes = {
  '/page': (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); },
  '/plain': (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Line one.\r\nLine two.\r\n\r\n\r\n\r\nLast.'); },
  '/latin': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(Buffer.concat([Buffer.from('<html><head><meta charset="windows-1252"></head><body><p>Caf'), Buffer.from([0xe9, 0x20, 0x93]), Buffer.from('quoted'), Buffer.from([0x94]), Buffer.from('</p></body></html>')]));
  },
  '/declared-large': (req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-length': '5000' }); res.end('x'.repeat(5000)); },
  '/streamed-large': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.write('x'.repeat(800)); res.end('y'.repeat(800)); },
  '/gzip-bomb': (req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('a'.repeat(200000))); },
  '/gzip-ok': (req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('<p>Compressed text.</p>')); },
  '/slow': () => {},
  '/json': (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); },
  '/pdf': (req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.7'); },
  '/missing': (req, res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('gone'); },
  '/to-private-literal': (req, res) => { res.writeHead(302, { location: 'http://10.0.0.1/secret' }); res.end(); },
  '/to-private-name': (req, res) => { res.writeHead(302, { location: 'http://intranet.test/secret' }); res.end(); }
};
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const hop = req.url.match(/^\/hop\/(\d+)$/);
    if (hop) { const next = Number(hop[1]); res.writeHead(302, { location: next ? `/hop/${next - 1}` : '/page' }); res.end(); return; }
    (routes[req.url] || routes['/missing'])(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); });

const local = (options = {}) => createPageFetcher({ allowPrivateAddresses: true, ...options });
const failure = promise => promise.then(() => null, error => error);
/** A lookup answering every name with fixed addresses, in the shape dns.lookup uses for `all`. */
const answering = (...addresses) => (hostname, options, callback) => callback(null, addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })));

describe('bounded page fetch', () => {
  it('fetches an allowed page with its final URL, type, size and byte hash', async () => {
    const page = await local().fetchPage(`${base}/hop/2`);
    expect(page).toMatchObject({ url: `${base}/page`, status: 200, contentType: 'text/html; charset=utf-8', charset: 'utf-8', bytes: Buffer.byteLength(PAGE) });
    expect(page.byteSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await local().fetchPage(`${base}/gzip-ok`)).body.toString()).toBe('<p>Compressed text.</p>');
  });

  it('refuses private and reserved addresses by default, including through DNS answers and redirects', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ['93.184.216.34', '2606:4700:4700::1111', '::ffff:93.184.216.34']) expect(isBlockedAddress(address), address).toBe(false);
    expect(await failure(createPageFetcher().fetchPage(`${base}/page`))).toMatchObject({ code: 'blocked-address' });
    expect(await failure(createPageFetcher().fetchPage('http://[::1]/'))).toMatchObject({ code: 'blocked-address' });
    expect(await failure(createPageFetcher({ lookup: answering('10.0.0.1') }).fetchPage('http://rebinding.test/'))).toMatchObject({ code: 'blocked-address' });
    expect(await failure(createPageFetcher({ lookup: answering('93.184.216.34', '127.0.0.1') }).fetchPage('http://mixed.test/'))).toMatchObject({ code: 'blocked-address' });
    // Only this test server's loopback address is permitted; every redirect hop is checked again.
    const port = new URL(base).port, lookup = (hostname, options, callback) => answering(hostname === 'intranet.test' ? '10.0.0.2' : '127.0.0.1')(hostname, options, callback);
    const guarded = createPageFetcher({ lookup, isBlocked: address => address !== '127.0.0.1' && isBlockedAddress(address) });
    expect((await guarded.fetchPage(`http://public.test:${port}/page`)).status).toBe(200);
    expect(await failure(guarded.fetchPage(`http://public.test:${port}/to-private-literal`))).toMatchObject({ code: 'blocked-address' });
    expect(await failure(guarded.fetchPage(`http://public.test:${port}/to-private-name`))).toMatchObject({ code: 'blocked-address' });
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'http://user:secret@example.com/', 'not a url']) {
      expect(await failure(createPageFetcher().fetchPage(url)), url).toMatchObject({ code: 'invalid-url' });
    }
  });

  it('caps declared, streamed and decompressed bytes, time and redirects', async () => {
    const small = local({ maxBytes: 1000 });
    expect(await failure(small.fetchPage(`${base}/declared-large`))).toMatchObject({ code: 'too-large' });
    expect(await failure(small.fetchPage(`${base}/streamed-large`))).toMatchObject({ code: 'too-large' });
    expect(await failure(local({ maxBytes: 10000 }).fetchPage(`${base}/gzip-bomb`))).toMatchObject({ code: 'too-large' });
    const started = Date.now();
    expect(await failure(local({ timeoutMs: 100 }).fetchPage(`${base}/slow`))).toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
    const caller = new AbortController(), pending = failure(local().fetchPage(`${base}/slow`, { signal: caller.signal }));
    caller.abort(); expect(await pending).toMatchObject({ code: 'cancelled' });
    expect(await failure(local({ maxRedirects: 3 }).fetchPage(`${base}/hop/2`))).toBeNull(); // three redirects
    expect(await failure(local({ maxRedirects: 3 }).fetchPage(`${base}/hop/3`))).toMatchObject({ code: 'too-many-redirects' });
    expect(await failure(local().fetchPage(`${base}/missing`))).toMatchObject({ code: 'http-error', status: 404 });
  });

  it('checks the content type before reading and declares PDF unsupported', async () => {
    expect(await failure(local().fetchPage(`${base}/json`))).toMatchObject({ code: 'unsupported-content-type', detail: 'application/json is not supported' });
    expect(await failure(local().fetchPage(`${base}/pdf`))).toMatchObject({ code: 'unsupported-content-type', detail: 'PDF text extraction is not supported' });
  });
});

describe('document text extraction', () => {
  it('keeps the main region as paragraphs without scripts, styles, comments or page chrome', async () => {
    const page = await local().fetchPage(`${base}/page`);
    const { text, title, characters } = extractDocumentText(page);
    expect(title).toBe('Eiffel & Paris');
    expect(text).toBe([
      'The Eiffel Tower',
      'The tower was completed in 1889 for the Exposition Universelle — a world\'s fair.',
      'Height: 330 m\nDesigner: Gustave Eiffel\'s company',
      'Opened 1889',
      'Unclosed paragraph with &unknown; entity'].join('\n\n'));
    expect(characters).toBe(text.length);
    for (const absent of ['not text', 'Home', 'Site banner', 'Advertisement', 'Copyright', 'Enable JS', 'commented out', 'color:red', 'Short aside']) {
      expect(text, absent).not.toContain(absent);
    }
  });

  it('decodes declared charsets and plain text; falls back to the article or body without <main>', async () => {
    expect(extractDocumentText(await local().fetchPage(`${base}/latin`)).text).toBe('Café “quoted”');
    expect(extractDocumentText(await local().fetchPage(`${base}/plain`)).text).toBe('Line one.\nLine two.\n\nLast.');
    const html = body => extractDocumentText({ body: Buffer.from(body), contentType: 'text/html' }).text;
    expect(html('<body><article><p>a</p></article><article><p>The longer article wins.</p></article></body>')).toBe('The longer article wins.');
    expect(html('<BODY><DIV>Upper <I>case</I> tags</DIV><img alt="x > y" src="a.png">and text</BODY>')).toBe('Upper case tags\n\nand text');
    // A page that is all chrome keeps its text rather than returning nothing.
    expect(html('<body><nav>Only navigation text</nav></body>')).toBe('Only navigation text');
    expect(html('<body><script>unterminated')).toBe('');
    expect(decodeEntities('&lt;a&gt; &amp &copy; &#x1F600; &#0; &bogus;')).toBe('<a> & © 😀 � &bogus;');
  });
});

describe('passage selection', () => {
  const doc = ['Intro paragraph about Paris museums.', 'The Eiffel Tower was completed in 1889.', 'It is 330 metres tall.',
    'Unrelated closing words.'].join('\n\n');
  it('returns an exact slice of the document around the paragraph that names the query words', () => {
    const passage = selectPassage({ text: doc, query: 'When was the Eiffel Tower completed?', maxCharacters: 80 });
    expect(doc.slice(passage.start, passage.end)).toBe(passage.text);
    expect(passage.text).toBe('The Eiffel Tower was completed in 1889.\n\nIt is 330 metres tall.');
    expect(selectPassage({ text: doc, query: 'zebra', maxCharacters: 1000 })).toMatchObject({ start: 0, end: doc.length });
  });
  it('cuts an over-long paragraph at a word boundary and never includes surrounding whitespace', () => {
    const text = '  \n\n' + 'word '.repeat(50).trim() + '\n\n';
    const passage = selectPassage({ text, query: 'word', maxCharacters: 42 });
    expect(text.slice(passage.start, passage.end)).toBe(passage.text);
    expect(passage.text).toBe('word word word word word word word word');
    expect(passage.text).toBe(passage.text.trim());
    expect(selectPassage({ text: ' \n ', query: 'x', maxCharacters: 10 })).toEqual({ text: '', start: 0, end: 0 });
    expect(() => selectPassage({ text: 'a', maxCharacters: 0 })).toThrow('maxCharacters');
  });
});
