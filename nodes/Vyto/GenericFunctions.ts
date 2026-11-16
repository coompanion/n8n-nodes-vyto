import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IPollFunctions,
} from 'n8n-workflow';

type Context = IExecuteFunctions | IPollFunctions;

export const CASE_STATUSES = ['Neu', 'Zugeordnet', 'Bereit', 'Abgeschlossen', 'Archiviert'];

// One call to the vyto API v1 (docs/api/v1.yaml). The key is added by the vytoApi credential.
export async function vytoRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: Pick<IHttpRequestOptions, 'qs' | 'body' | 'headers' | 'json'> = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('vytoApi');
	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'vytoApi', {
		method,
		url: `${credentials.baseUrl as string}${path}`,
		json: true,
		...options,
	});
	return (typeof response === 'string' ? JSON.parse(response) : response) as IDataObject;
}

export interface CaseQuery {
	updated_since?: string;
	license_plate?: string;
	status?: string;
}

// GET /cases with cursor paging (ordered by updated_at ascending). Stops after `limit` cases if given.
export async function listCases(this: Context, query: CaseQuery, limit?: number): Promise<IDataObject[]> {
	const qs: IDataObject = { limit: 200 };
	for (const [key, value] of Object.entries(query)) if (value) qs[key] = value;
	const cases: IDataObject[] = [];
	for (;;) {
		const page = await vytoRequest.call(this, 'GET', '/cases', { qs });
		cases.push(...((page.data as IDataObject[]) ?? []));
		if (limit !== undefined && cases.length >= limit) return cases.slice(0, limit);
		if (!page.has_more || !page.next_cursor) return cases;
		qs.cursor = page.next_cursor;
	}
}

// multipart/form-data built by hand, so the package needs no runtime dependencies
export function multipartBody(
	file: { buffer: Buffer; fileName: string; mimeType: string },
	fields: Record<string, string>,
): { body: Buffer; contentType: string } {
	const boundary = `----vyto${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const parts: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		if (!value) continue;
		parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
	}
	const fileName = file.fileName.replace(/["\r\n]/g, '_');
	parts.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
			'utf8',
		),
		file.buffer,
		Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
	);
	return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Trigger state: last seen updated_at and the case ids at exactly that time (the API filters with >=)
export interface PollState {
	lastUpdatedAt?: string;
	lastIds?: string[];
}

export function newSince(cases: IDataObject[], state: PollState): { fresh: IDataObject[]; next: PollState } {
	const seen = new Set(state.lastIds ?? []);
	const fresh = cases.filter((c) => !(c.updated_at === state.lastUpdatedAt && seen.has(c.id as string)));
	if (cases.length === 0) return { fresh, next: state };
	const last = cases[cases.length - 1].updated_at as string;
	const atLast = cases.filter((c) => c.updated_at === last).map((c) => c.id as string);
	const ids = last === state.lastUpdatedAt ? [...new Set([...(state.lastIds ?? []), ...atLast])] : atLast;
	return { fresh, next: { lastUpdatedAt: last, lastIds: ids } };
}

// vyto answers errors as { error: { code, message } }; show that message instead of n8n's generic HTTP text
export function vytoErrorMessage(error: unknown): string | undefined {
	const e = error as { cause?: { response?: { data?: unknown } }; response?: { data?: unknown; body?: unknown } };
	for (const raw of [e?.cause?.response?.data, e?.response?.data, e?.response?.body]) {
		const data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return undefined; } })() : raw;
		const message = (data as { error?: { message?: unknown } } | undefined)?.error?.message;
		if (typeof message === 'string' && message) return message;
	}
	return undefined;
}
