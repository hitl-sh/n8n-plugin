import type { IDataObject } from 'n8n-workflow';

/** The two API hosts the key may go to. Nothing the user types can change the host. */
export const baseUrlFor = (environment: unknown): string =>
	environment === 'development' ? 'https://dev.api.hitl.sh/v1' : 'https://api.hitl.sh/v1';

export type WaitMode = 'auto' | 'callback' | 'poll' | 'none';
export type Wait = 'callback' | 'poll' | 'none';

const PRIVATE_HOST =
	/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])|\.(local|internal|localhost|lan)$/i;

/** The API only calls back to https URLs on public hosts. */
export function isReachableUrl(url: string | undefined): boolean {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === 'https:' &&
			parsed.hostname.includes('.') &&
			!PRIVATE_HOST.test(parsed.hostname)
		);
	} catch {
		return false;
	}
}

/**
 * How to wait for the answer. A callback frees the n8n worker while people decide, but resumes one
 * execution once, so it takes a single item and cannot run inside an AI agent's tool call.
 */
export function chooseWait(
	mode: WaitMode,
	context: { resumeUrl?: string; itemCount: number; isTool: boolean },
): { wait: Wait; problem?: string } {
	if (mode === 'none' || mode === 'poll') return { wait: mode };
	const reachable = isReachableUrl(context.resumeUrl);
	if (mode === 'auto') {
		return { wait: reachable && context.itemCount === 1 && !context.isTool ? 'callback' : 'poll' };
	}
	if (context.isTool) return { wait: 'callback', problem: 'Callback waiting cannot run as an AI tool. Use Poll.' };
	if (context.itemCount !== 1) {
		return {
			wait: 'callback',
			problem: 'Callback waiting takes one item at a time. Use a Loop Over Items node, or choose Poll.',
		};
	}
	if (!reachable) {
		return {
			wait: 'callback',
			problem:
				'HITL cannot reach this n8n: callbacks need a public https address (set WEBHOOK_URL), or choose Poll.',
		};
	}
	return { wait: 'callback' };
}

/** Parses a JSON parameter into an object. */
export function parseObject(value: unknown, name: string, fail: (message: string) => never): IDataObject {
	let parsed = value;
	if (typeof value === 'string') {
		const text = value.trim();
		if (text === '') return {};
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			return fail(`${name} is not valid JSON: ${(error as Error).message}`);
		}
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return fail(`${name} must be a JSON object`);
	}
	return parsed as IDataObject;
}

/** Every API answer is {error, msg, data}. */
export const unwrap = (answer: unknown): IDataObject => {
	const body = (answer ?? {}) as IDataObject;
	return (body.data ?? body) as IDataObject;
};

export const runFinished = (run: IDataObject): boolean => run.finished === true;

const REQUEST_ENDED = new Set(['completed', 'timeout', 'cancelled']);
export const requestFinished = (request: IDataObject): boolean =>
	REQUEST_ENDED.has(String(request.status));

const OBJECT_ID = /^[0-9a-f]{24}$/;

/** The id a callback names: a run's for a workflow, the request's otherwise. Undefined if there is none. */
export function callbackId(resource: string, body: IDataObject): string | undefined {
	const raw =
		resource === 'request' ? body.request_id : ((body.execution ?? {}) as IDataObject).id;
	return typeof raw === 'string' && OBJECT_ID.test(raw) ? raw : undefined;
}

/** What the API said, from an error n8n's request helper already wrapped. */
export const apiReason = (error: unknown): string | undefined =>
	(error as { context?: { data?: { msg?: string } } }).context?.data?.msg;

export const requestError = (error: unknown): { status?: number; message: string } => {
	const e = error as {
		httpCode?: string;
		statusCode?: number;
		status?: number;
		message?: string;
		description?: string;
		response?: { status?: number; data?: { msg?: string } };
		context?: { data?: { msg?: string } };
	};
	const status = e.response?.status ?? e.statusCode ?? e.status ?? (Number(e.httpCode) || undefined);
	const message =
		e.response?.data?.msg ?? e.context?.data?.msg ?? e.description ?? e.message ?? 'Request failed';
	return { status, message };
};

const isPermanent = (status?: number) =>
	status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;

export interface PollOptions {
	maxMs: number;
	retryDelayMs?: number;
	maxFailures?: number;
	now?: () => number;
	sleep: (ms: number) => Promise<void>;
	/** Ends the wait with this error. */
	fail: (error: unknown) => never;
}

/**
 * Calls read until done() says so or maxMs passes. read long-polls, so this does not spin. Network
 * and server errors are retried a few times in a row; a 4xx ends it. On giving up it answers the
 * last value with finished false, so the workflow can decide what to do.
 */
export async function pollUntil(
	read: () => Promise<IDataObject>,
	done: (value: IDataObject) => boolean,
	options: PollOptions,
): Promise<{ value: IDataObject; finished: boolean }> {
	const now = options.now ?? Date.now;
	const retryDelay = options.retryDelayMs ?? 5000;
	const maxFailures = options.maxFailures ?? 5;
	const deadline = now() + options.maxMs;
	let failures = 0;
	let last: IDataObject | undefined;
	for (;;) {
		try {
			last = await read();
			failures = 0;
			if (done(last)) return { value: last, finished: true };
		} catch (error) {
			failures++;
			if (isPermanent(requestError(error).status) || failures >= maxFailures) return options.fail(error);
		}
		if (now() >= deadline) {
			if (last) return { value: last, finished: false };
			return options.fail(new Error('No answer from HITL before the wait ended'));
		}
		await options.sleep(failures > 0 ? retryDelay : 1000);
	}
}
