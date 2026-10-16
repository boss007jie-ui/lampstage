import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const samples = [
  ['image', 'a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
  ['image', 'b.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
  ['image', 'c.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
  ['image', 'd.webp', Buffer.from('RIFFxxxxWEBP', 'ascii')],
  ['video', 'e.mp4', Buffer.from([0, 0, 0, 12, ...Buffer.from('ftypisom', 'ascii')])],
  ['video', 'f.mov', Buffer.from([0, 0, 0, 12, ...Buffer.from('ftypqt  ', 'ascii')])],
  ['video', 'g.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])],
];

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lampstage-local-upload-'));
  t.after(async () => {
    const resolved = path.resolve(directory), temp = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(temp + path.sep));
    await rm(resolved, { recursive: true, force: true });
  });
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url, method: request.method, authorization: request.headers.authorization,
      contentType: request.headers['content-type'], body: Buffer.concat(chunks) });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'uploaded' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [bridge], { env: { ...process.env, LAMPSTAGE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`, LAMPSTAGE_API_KEY: 'local-test-key' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { child.kill(); await new Promise(resolve => server.close(resolve)); });
  let buffer = '', nextId = 0; const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const reply = JSON.parse(line), waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timeout); waiter.resolve(reply); }
    }
  });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`Bridge exited: ${code}`)); pending.clear(); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Bridge response timeout')); }, 5000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { directory, requests, rpc, call: (name, args) => rpc('tools/call', { name, arguments: args }) };
}

test('stdio local-upload schema exists and all allowed image/video headers reach authenticated multipart endpoints', async t => {
  const f = await fixture(t);
  const tools = (await f.rpc('tools/list', {})).result.tools;
  assert.ok(tools.some(tool => tool.name === 'upload_local_asset'));
  for (const [kind, filename, bytes] of samples) {
    const file_path = path.join(f.directory, filename);
    await writeFile(file_path, bytes);
    const response = await f.call('upload_local_asset', { file_path, kind });
    assert.equal(response.error, undefined, `${filename}: ${response.error?.message}`);
  }
  assert.equal(f.requests.length, samples.length);
  for (let i = 0; i < samples.length; i++) {
    const [kind, filename, bytes] = samples[i], request = f.requests[i];
    assert.equal(request.method, 'POST');
    assert.equal(request.path, kind === 'video' ? '/api/v1/video-assets' : '/api/v1/assets');
    assert.equal(request.authorization, 'Bearer local-test-key');
    assert.match(request.contentType, /^multipart\/form-data; boundary=/);
    assert.ok(request.body.includes(Buffer.from(filename)));
    assert.ok(request.body.includes(bytes));
  }
});

test('local upload rejects relative paths, directories, mismatched headers and oversized files before HTTP', async t => {
  const f = await fixture(t);
  const wrong = path.join(f.directory, 'wrong.png');
  await writeFile(wrong, Buffer.from('not a PNG file'));
  const oversizedImage = path.join(f.directory, 'large.jpg');
  await writeFile(oversizedImage, Buffer.alloc(5 * 1024 * 1024 + 1));
  const oversizedVideo = path.join(f.directory, 'large.mp4');
  const handle = await open(oversizedVideo, 'w');
  try { await handle.truncate(150 * 1024 * 1024 + 1); } finally { await handle.close(); }
  const invalid = [
    { file_path: 'relative.jpg', kind: 'image' },
    { file_path: f.directory, kind: 'image' },
    { file_path: wrong, kind: 'image' },
    { file_path: oversizedImage, kind: 'image' },
    { file_path: oversizedVideo, kind: 'video' },
    { file_path: wrong, kind: 'video' },
  ];
  for (const args of invalid) assert.ok((await f.call('upload_local_asset', args)).error);
  assert.deepEqual(f.requests, []);
});
