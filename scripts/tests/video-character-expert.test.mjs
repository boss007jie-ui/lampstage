import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../../workbuddy-expert/lampstage-creative-expert/scripts/lampstage-http.mjs', import.meta.url));
const remoteCatalog = fileURLToPath(new URL('../../apps/web/lib/mcp-tools.ts', import.meta.url));
const fixtureKey = 'fixture-only-character-key';
const names = ['list_characters', 'get_character', 'save_character', 'save_character_version', 'update_character', 'list_character_assets'];
const baseVersion = { id: 'ver-1', version: 1, description: 'A fixed identity', content_digest: 'a'.repeat(64), created_at: '2026-10-16T00:00:00.000Z', reference_assets: [{ index: 0, asset_id: 'asset-1', label: 'Front', image_url: 'https://media.example.invalid/front.jpg?signature=a%2Bb', sha256: 'b'.repeat(64), size_bytes: 1234, width: 100, height: 200 }] };
const baseCharacter = { id: 'char-1', code: 'C001', name: 'Mother', category: 'Apparel', archived: false, latest_version_id: 'ver-1', version_count: 1, reference_count: 2, cover_url: baseVersion.reference_assets[0].image_url, created_at: '2026-10-16T00:00:00.000Z', updated_at: '2026-10-16T00:00:00.000Z' };
const save = { idempotency_key: 'stable_key-001', name: 'Mother', category: 'Apparel', description: 'A fixed identity', reference_assets: [{ asset_id: 'asset-1', label: 'Front' }] };
const versionSave = { expected_latest_version_id: 'ver-1', description: 'The same person, new view', reference_assets: [{ asset_id: 'asset-2', label: 'Side' }] };
const image = { asset_id: 'asset-1', role: 'character', label: 'Front' };
const bound = { ...image, character_version_id: 'ver-1', image_index: 0 };
const oneOff = { ...image, character_version_id: null };
const job = refs => ({ source_asset_id: 'source-1', generation_mode: 'six_references', reference_assets: [{ asset_id: 'opening', role: 'start_state', label: 'Reviewed opening' }, ...refs], segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: 'Turn', before_state: 'Facing forward', after_state: 'Facing left', reference_assets: [{ asset_id: 'opening', role: 'start_state', label: 'Reviewed opening' }, ...refs] }] });

async function fixture(t) {
  const requests = [];
  const state = { status: 200, response: {}, raw: null, characterCapability: true };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    assert.equal(req.headers.authorization, `Bearer ${fixtureKey}`);
    res.statusCode = req.url === '/api/v1/capabilities' ? 200 : state.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url === '/api/v1/capabilities'
      ? JSON.stringify({ capabilities: [
        { id: 'video.replicate', status: 'available', modes: { six_references: true } },
        ...(state.characterCapability ? [{ id: 'characters.library', status: 'available' }] : []),
      ] })
      : state.raw ?? JSON.stringify(state.response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [bridge], {
    env: { SystemRoot: process.env.SystemRoot ?? '', LAMPSTAGE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`, LAMPSTAGE_API_KEY: fixtureKey },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let id = 0, buffer = '', stderr = '';
  const pending = new Map();
  child.stderr.setEncoding('utf8'); child.stderr.on('data', value => { stderr += value; });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', value => {
    buffer += value;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const waiter = pending.get(reply.id);
      if (waiter) { pending.delete(reply.id); clearTimeout(waiter.timer); waiter.resolve(reply); }
    }
  });
  const failPending = error => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
  child.on('error', failPending); child.on('exit', code => failPending(new Error(`bridge exit ${code}: ${stderr}`)));
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(stderr.includes(fixtureKey), false); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const next = ++id; const timer = setTimeout(() => { pending.delete(next); reject(new Error(`bridge timeout: ${stderr}`)); }, 5000);
    pending.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { requests, state, call: (name, args) => rpc('tools/call', { name, arguments: args }), list: () => rpc('tools/list') };
}

function result(reply) { assert.equal(reply.error, undefined); assert.equal(reply.result?.isError, undefined); return reply.result.structuredContent; }
function rejected(reply) { assert.ok(reply.error, 'invalid input must be rejected by bridge'); assert.doesNotMatch(reply.error.message, /^Unknown tool:/); }
function request(method, path, body = null) { return { method, path, body }; }

test('28 local tools include six character schemas matching the remote static catalog and paired reference fields', async t => {
  const f = await fixture(t);
  const source = await readFile(remoteCatalog, 'utf8');
  const match = source.match(/export const MCP_TOOLS = (\[[\s\S]*?\]) as const;/);
  assert.ok(match, 'static MCP catalog declaration is readable');
  const remote = vm.runInNewContext(`(${match[1]})`, { IMAGE_REFERENCE_ROLES: ['character', 'product', 'product_detail', 'scene', 'start_state', 'end_state'], DEFAULT_IMAGE_MODEL: 'nano_banana_21' }, { timeout: 1000 });
  const local = (await f.list()).result.tools;
  assert.equal(local.length, 28);
  assert.equal(new Set(local.map(tool => tool.name)).size, 28);
  for (const name of names) {
    const a = local.find(tool => tool.name === name);
    const b = remote.find(tool => tool.name === name);
    assert.ok(a && b, `${name} must exist in both catalogs`);
    assert.deepEqual(a.inputSchema, JSON.parse(JSON.stringify(b.inputSchema)), name);
  }
  const localJob = local.find(tool => tool.name === 'create_video_job').inputSchema;
  const remoteJob = remote.find(tool => tool.name === 'create_video_job').inputSchema;
  for (const path of [
    schema => schema.properties.reference_assets.items,
    schema => schema.properties.segment_plan.items.properties.reference_assets.items,
  ]) {
    assert.deepEqual(path(localJob), JSON.parse(JSON.stringify(path(remoteJob))));
    assert.ok('character_version_id' in path(localJob).properties);
    assert.ok('image_index' in path(localJob).properties);
  }
  assert.deepEqual(f.requests, []);
});

test('character lists forward search, status, opaque cursor and bounds; detail preserves version metadata', async t => {
  const f = await fixture(t);
  const cursor = 'opaque_-Cursor.encoded';
  f.state.response = { characters: [baseCharacter], next_cursor: cursor };
  assert.deepEqual(result(await f.call('list_characters', { status: 'archived', q: 'Mum & C001', limit: 50, cursor })), f.state.response);
  const listUrl = new URL(f.requests[0].path, 'http://localhost');
  assert.equal(listUrl.pathname, '/api/v1/characters');
  assert.deepEqual(Object.fromEntries(listUrl.searchParams), { status: 'archived', q: 'Mum & C001', limit: '50', cursor });
  f.state.response = { character: { ...baseCharacter, archived: true }, versions: [{ id: 'ver-1', version: 1, created_at: baseVersion.created_at }], selected_version: baseVersion };
  assert.deepEqual(result(await f.call('get_character', { character_id: 'char-1', version_id: 'ver-1' })), f.state.response);
  assert.deepEqual(f.requests[1], request('GET', '/api/v1/characters/char-1?version_id=ver-1'));
  f.state.response = { assets: [{ asset_id: 'asset-1', image_url: baseVersion.reference_assets[0].image_url, width: 100, height: 200, sha256: 'b'.repeat(64), created_at: baseVersion.created_at }], next_cursor: cursor };
  assert.deepEqual(result(await f.call('list_character_assets', { limit: 1, cursor })), f.state.response);
  const assetUrl = new URL(f.requests[2].path, 'http://localhost');
  assert.equal(assetUrl.pathname, '/api/v1/character-assets');
  assert.deepEqual(Object.fromEntries(assetUrl.searchParams), { limit: '1', cursor });
  assert.ok(f.requests.every(entry => entry.method === 'GET' && entry.body === null));
});

test('explicit character save is independent of feedback, template and video creation; key remains exact', async t => {
  const f = await fixture(t);
  f.state.status = 201;
  f.state.response = { character: baseCharacter, selected_version: baseVersion, reused: false };
  assert.deepEqual(result(await f.call('save_character', save)), f.state.response);
  assert.deepEqual(f.requests, [request('POST', '/api/v1/characters', save)]);
  f.state.status = 200;
  f.state.response = { ...f.state.response, reused: true, character: { ...baseCharacter, archived: true } };
  assert.deepEqual(result(await f.call('save_character', save)), f.state.response);
  assert.deepEqual(f.requests[1], request('POST', '/api/v1/characters', save));
  assert.equal(f.requests.length, 2);
});

test('version save forwards expected_latest_version_id unchanged; profile PATCH archives and restores', async t => {
  const f = await fixture(t);
  f.state.response = { character: { ...baseCharacter, latest_version_id: 'ver-2', version_count: 2 }, selected_version: { ...baseVersion, id: 'ver-2', version: 2 }, reused: false };
  assert.deepEqual(result(await f.call('save_character_version', { character_id: 'char-1', ...versionSave })), f.state.response);
  assert.deepEqual(f.requests[0], request('POST', '/api/v1/characters/char-1/versions', versionSave));
  for (const patch of [{ name: 'Mum' }, { category: '' }, { archived: true }, { archived: false }]) {
    f.state.response = { character: { ...baseCharacter, ...patch } };
    assert.deepEqual(result(await f.call('update_character', { character_id: 'char-1', ...patch })), f.state.response);
    assert.deepEqual(f.requests.at(-1), request('PATCH', '/api/v1/characters/char-1', patch));
  }
});

test('409 conflicts and unknown outcomes never trigger a second POST', async t => {
  const f = await fixture(t);
  f.state.status = 409;
  f.state.response = { error: 'character_idempotency_conflict' };
  const conflict = await f.call('save_character', save);
  assert.ok(conflict.error || conflict.result?.isError);
  assert.match(conflict.error?.message ?? JSON.stringify(conflict.result), /character_idempotency_conflict/);
  assert.deepEqual(f.requests, [request('POST', '/api/v1/characters', save)]);
  f.state.status = 200;
  f.state.raw = 'not-json';
  const unknown = await f.call('save_character_version', { character_id: 'char-1', ...versionSave });
  assert.ok(unknown.error || unknown.result?.isError);
  assert.match(unknown.error?.message ?? JSON.stringify(unknown.result), /list_characters\/get_character/);
  assert.match(unknown.error?.message ?? JSON.stringify(unknown.result), /original request/);
  assert.deepEqual(f.requests[1], request('POST', '/api/v1/characters/char-1/versions', versionSave));
  assert.equal(f.requests.length, 2);
});

test('bound, one-off and omitted reference fields survive create body at both levels', async t => {
  const f = await fixture(t);
  for (const ref of [bound, oneOff, image]) {
    const args = job([ref]);
    result(await f.call('create_video_job', args));
    assert.deepEqual(f.requests.slice(-2), [request('GET', '/api/v1/capabilities'), request('POST', '/api/v1/video-jobs', args)]);
  }
});

test('bound reference stops after capabilities when character library is unavailable', async t => {
  const f = await fixture(t);
  f.state.characterCapability = false;
  for (const ref of [bound, oneOff]) {
    const reply = await f.call('create_video_job', job([ref]));
    assert.ok(reply.error || reply.result?.isError);
  }
  assert.deepEqual(f.requests, Array(2).fill(request('GET', '/api/v1/capabilities')));
  result(await f.call('create_video_job', job([image])));
  assert.deepEqual(f.requests.slice(-2), [request('GET', '/api/v1/capabilities'), request('POST', '/api/v1/video-jobs', job([image]))]);
});

test('schema 1/2 template detail and delivery character metadata pass through verbatim', async t => {
  const f = await fixture(t);
  for (const recipe_schema_version of [1, 2]) {
    f.state.response = { template: { id: 'tpl-1', code: 'T001' }, versions: [{ id: 'tpl-ver-1', version: 1 }], selected_version: { id: 'tpl-ver-1', recipe_schema_version, create_payload: job(recipe_schema_version === 2 ? [bound] : [image]), character_bindings: recipe_schema_version === 2 ? [{ segment_index: -1, reference_index: 0, character_id: 'char-1', code: 'C001', name: 'Mother', character_version_id: 'ver-1', version: 1, image_index: 0 }] : [] } };
    assert.deepEqual(result(await f.call('get_video_template', { template_id: 'tpl-1', version_id: 'tpl-ver-1' })), f.state.response);
    assert.deepEqual(f.requests.at(-1), request('GET', '/api/v1/video-templates/tpl-1?version_id=tpl-ver-1'));
  }
  f.state.response = { job_id: 'job-1', status: 'completed', character_references: [{ asset_id: 'asset-1', label: 'Front', image_url: baseVersion.reference_assets[0].image_url, sha256: 'b'.repeat(64), character_id: 'char-1', character_version_id: 'ver-1', image_index: 0 }] };
  assert.deepEqual(result(await f.call('get_video_delivery', { job_id: 'job-1' })), f.state.response);
  assert.deepEqual(f.requests.at(-1), request('GET', '/api/v1/video-jobs/job-1/delivery'));
});

test('invalid character calls reject before any network request', async t => {
  const f = await fixture(t);
  const invalid = [
    ['list_characters', { status: 'deleted' }], ['list_characters', { q: 'x'.repeat(81) }],
    ['list_characters', { limit: 0 }], ['list_characters', { limit: 51 }],
    ['list_characters', { cursor: 'x'.repeat(513) }], ['list_characters', { extra: true }],
    ['get_character', { character_id: 'bad/segment' }], ['get_character', { character_id: 'char-1', version_id: 'bad\nversion' }],
    ['list_character_assets', { limit: 0 }], ['list_character_assets', { cursor: 'x'.repeat(513) }],
    ['save_character', { ...save, idempotency_key: 'bad/segment' }],
    ['save_character', { ...save, name: '' }], ['save_character', { ...save, name: 'x'.repeat(81) }],
    ['save_character', { ...save, category: 'x'.repeat(41) }], ['save_character', { ...save, description: 'x'.repeat(2001) }],
    ['save_character', { ...save, name: 'bad\nname' }], ['save_character', { ...save, description: 'bad\u0000description' }],
    ['save_character', { ...save, reference_assets: [] }],
    ['save_character', { ...save, reference_assets: [save.reference_assets[0], save.reference_assets[0]] }],
    ['save_character', { ...save, reference_assets: Array(7).fill({ asset_id: 'same', label: 'Same' }) }],
    ['save_character', { ...save, reference_assets: [{ asset_id: 'asset-1', label: '' }] }],
    ['save_character', { ...save, reference_assets: [{ asset_id: 'asset-1', label: 'Front', image_url: 'private' }] }],
    ['save_character', { ...save, surprise: true }],
    ...['job_id', 'review_token', 'receipt', 'candidate', 'budget', 'renderConsent', 'feedback'].map(field => ['save_character', { ...save, [field]: 'old-paid-state' }]),
    ['save_character_version', { character_id: 'char-1', ...versionSave, expected_latest_version_id: 'bad/id' }],
    ['save_character_version', { character_id: 'char-1', ...versionSave, idempotency_key: 'wrong-contract' }],
    ['update_character', { character_id: 'char-1' }], ['update_character', { character_id: 'char-1', name: '' }],
    ['update_character', { character_id: 'char-1', archived: 'true' }],
    ['update_character', { character_id: 'char-1', description: 'mutable?' }],
  ];
  for (const [name, args] of invalid) rejected(await f.call(name, args));
  assert.deepEqual(f.requests, []);
});

test('JSON body accepts exactly 16 KiB and rejects the next byte with valid field lengths', async t => {
  const f = await fixture(t);
  // JSON escapes lone UTF-16 surrogates; field length limits alone cannot bound wire bytes.
  const body = { idempotency_key: 'kkkk', name: '\ud800'.repeat(80), category: '\ud800'.repeat(40),
    description: '\ud800'.repeat(1961), reference_assets: Array.from({ length: 6 }, (_, i) =>
      ({ asset_id: `asset-${i}`.padEnd(128, 'x'), label: '\ud800'.repeat(80) })) };
  assert.equal(Buffer.byteLength(JSON.stringify(body)), 16 * 1024);
  result(await f.call('save_character', body));
  const oversized = { ...body, idempotency_key: 'kkkkk' };
  assert.equal(Buffer.byteLength(JSON.stringify(oversized)), 16 * 1024 + 1);
  const reply = await f.call('save_character', oversized);
  rejected(reply);
  assert.match(reply.error.message, /Character request body exceeds 16 KiB/);
  assert.deepEqual(f.requests, [request('POST', '/api/v1/characters', body)]);
});

test('invalid binding combinations and bindings outside six_references fail before capabilities', async t => {
  const f = await fixture(t);
  const invalidRefs = [
    { ...image, character_version_id: 'ver-1' },
    { ...image, image_index: 0 },
    { ...image, character_version_id: null, image_index: 0 },
    { ...image, character_version_id: 1, image_index: 0 },
    { ...image, character_version_id: 'bad/id', image_index: 0 },
    { ...image, character_version_id: 'ver-1', image_index: -1 },
    { ...image, character_version_id: 'ver-1', image_index: 6 },
    { ...image, character_version_id: 'ver-1', image_index: 1.5 },
    { ...image, character_version_id: 'ver-1', image_index: '0' },
    { ...image, character_version_id: 'ver-1', image_index: 0, extra: true },
    { ...image, role: 'product', character_version_id: 'ver-1', image_index: 0 },
    { ...image, role: 'product', character_version_id: null },
  ];
  for (const ref of invalidRefs) {
    rejected(await f.call('create_video_job', job([ref])));
    rejected(await f.call('create_video_job', { ...job([image]), segment_plan: job([ref]).segment_plan }));
  }
  for (const generation_mode of ['direct_references', 'legacy_frames']) {
    rejected(await f.call('create_video_job', { ...job([bound]), generation_mode }));
    rejected(await f.call('create_video_job', { ...job([oneOff]), generation_mode }));
    rejected(await f.call('create_video_job', { ...job([image]), segment_plan: job([bound]).segment_plan, generation_mode }));
  }
  assert.deepEqual(f.requests, []);
});
