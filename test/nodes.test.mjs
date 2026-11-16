// Tests for the built nodes (dist) with a minimal stand-in for n8n's execution context.
// Without VYTO_API_KEY the API is a fake; with VYTO_API_KEY (and VYTO_BASE_URL) the calls go to the real vyto API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Vyto } = require('../dist/nodes/Vyto/Vyto.node.js');
const { VytoTrigger } = require('../dist/nodes/Vyto/VytoTrigger.node.js');
const { VytoApi } = require('../dist/credentials/VytoApi.credentials.js');
const { newSince, multipartBody } = require('../dist/nodes/Vyto/GenericFunctions.js');

const LIVE = !!process.env.VYTO_API_KEY;
const BASE = process.env.VYTO_BASE_URL ?? 'https://fake.vyto.test/api/v1';

// ── fake vyto API ──
const CASES = Array.from({ length: 5 }, (_, i) => ({
	id: `00000000-0000-0000-0000-00000000000${i}`,
	status: i % 2 ? 'Zugeordnet' : 'Neu',
	license_plate: `B VY ${100 + i}`,
	updated_at: new Date(Date.UTC(2026, 10, 1, 10, i)).toISOString(),
}));
function fakeApi(req) {
	const url = new URL(req.url);
	assert.equal(req.headers?.Authorization, 'Bearer vyto_test');
	if (url.pathname.endsWith('/cases')) {
		const qs = req.qs ?? {};
		let rows = CASES.filter((c) => !qs.updated_since || c.updated_at >= qs.updated_since);
		if (qs.status) rows = rows.filter((c) => qs.status.split(',').includes(c.status));
		const start = qs.cursor ? Number(qs.cursor) : 0;
		const page = rows.slice(start, start + 2); // small pages to exercise the cursor
		const more = start + 2 < rows.length;
		return { data: page, has_more: more, next_cursor: more ? String(start + 2) : null };
	}
	if (url.pathname.endsWith('/documents') && req.method === 'POST') {
		const text = req.body.toString('utf8');
		assert.match(req.headers['Content-Type'], /^multipart\/form-data; boundary=/);
		assert.match(text, /name="file"; filename="owi\.pdf"\r\nContent-Type: application\/pdf/);
		assert.match(text, /name="external_ref"\r\n\r\nref-1\r\n/);
		return JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', status: 'received' });
	}
	if (/\/documents\/[0-9a-f-]{36}$/.test(url.pathname)) return { id: url.pathname.split('/').pop(), status: 'processed' };
	throw Object.assign(new Error('not found'), { httpCode: '404' });
}

// Same as n8n: the credential's "authenticate" adds the Authorization header
async function request(opts) {
	const headers = { ...(opts.headers ?? {}), Authorization: `Bearer ${LIVE ? process.env.VYTO_API_KEY : 'vyto_test'}` };
	if (!LIVE) return fakeApi({ ...opts, headers });
	const url = new URL(opts.url);
	for (const [k, v] of Object.entries(opts.qs ?? {})) url.searchParams.set(k, String(v));
	const r = await fetch(url, { method: opts.method, headers, body: opts.body });
	const text = await r.text();
	if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${text}`), { httpCode: String(r.status) });
	return opts.json === false ? text : JSON.parse(text);
}

function context({ params = {}, items = [{ json: {} }], mode = 'trigger', staticData = {}, binary } = {}) {
	return {
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => ({ apiKey: 'x', baseUrl: BASE }),
		getNode: () => ({ name: 'vyto', type: 'vyto', typeVersion: 1, parameters: {} }),
		getMode: () => mode,
		getWorkflowStaticData: () => staticData,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (name, opts) => {
				assert.equal(name, 'vytoApi');
				return request(opts);
			},
			returnJsonArray: (rows) => rows.map((json) => ({ json })),
			assertBinaryData: () => binary.meta,
			getBinaryDataBuffer: async () => binary.buffer,
		},
	};
}

test('credential: Bearer header and /ping as test', () => {
	const c = new VytoApi();
	assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(c.test.request.url, '/ping');
});

test('Case → Get Many: limit and cursor paging', async () => {
	const node = new Vyto();
	const [out] = await node.execute.call(context({ params: { resource: 'case', operation: 'getAll', returnAll: false, limit: 3, filters: {} } }));
	assert.equal(out.length, 3);
	assert.ok(out.every((o) => o.json.id && o.json.updated_at));
	if (LIVE) return;
	const [all] = await node.execute.call(context({ params: { resource: 'case', operation: 'getAll', returnAll: true, filters: { status: ['Neu'] } } }));
	assert.deepEqual(all.map((o) => o.json.status), ['Neu', 'Neu', 'Neu']);
});

test('Notice → Upload: multipart with file and fields', { skip: LIVE && 'live: upload is tested separately' }, async () => {
	const node = new Vyto();
	const [out] = await node.execute.call(
		context({
			params: { resource: 'document', operation: 'upload', binaryPropertyName: 'data', additionalFields: { externalRef: 'ref-1' } },
			binary: { meta: { fileName: 'owi.pdf', mimeType: 'application/pdf' }, buffer: Buffer.from('%PDF-1.4 test') },
		}),
	);
	assert.equal(out[0].json.status, 'received');
});

test('Notice → Get: rejects an invalid id before calling the API', async () => {
	const node = new Vyto();
	await assert.rejects(node.execute.call(context({ params: { resource: 'document', operation: 'get', documentId: 'abc' } })), /UUID/);
});

test('Trigger: first poll starts from now, later polls only return new or changed cases', { skip: LIVE && 'fake data only' }, async () => {
	const trigger = new VytoTrigger();
	const staticData = {};
	assert.equal(await trigger.poll.call(context({ params: { filters: {} }, staticData })), null);
	assert.ok(staticData.lastUpdatedAt);

	staticData.lastUpdatedAt = CASES[2].updated_at;
	staticData.lastIds = [CASES[2].id];
	const [out] = await trigger.poll.call(context({ params: { filters: {} }, staticData }));
	assert.deepEqual(out.map((o) => o.json.id), [CASES[3].id, CASES[4].id]);
	assert.equal(staticData.lastUpdatedAt, CASES[4].updated_at);
	assert.equal(await trigger.poll.call(context({ params: { filters: {} }, staticData })), null);
});

test('Trigger: manual run returns one sample case', async () => {
	const trigger = new VytoTrigger();
	const res = await trigger.poll.call(context({ params: { filters: {} }, mode: 'manual' }));
	if (LIVE && res === null) return; // no case changed in the last 30 days
	assert.equal(res[0].length, 1);
});

test('newSince: same timestamp, different ids are kept', () => {
	const t = '2026-11-01T10:00:00.000Z';
	const { fresh, next } = newSince([{ id: 'a', updated_at: t }, { id: 'b', updated_at: t }], { lastUpdatedAt: t, lastIds: ['a'] });
	assert.deepEqual(fresh.map((c) => c.id), ['b']);
	assert.deepEqual(next.lastIds.sort(), ['a', 'b']);
});

test('multipartBody: quotes in file names cannot break the header', () => {
	const { body } = multipartBody({ buffer: Buffer.from('x'), fileName: 'a"b.pdf', mimeType: 'application/pdf' }, {});
	assert.match(body.toString(), /filename="a_b\.pdf"/);
});
