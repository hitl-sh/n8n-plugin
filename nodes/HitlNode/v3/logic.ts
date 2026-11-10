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

const OBJECT_ID = /^[0-9a-f]{24}$/;

/** The id of the run a callback names. Undefined if there is none. */
export function callbackId(body: IDataObject): string | undefined {
	const raw = ((body.execution ?? {}) as IDataObject).id;
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

/** The HITL portal for the credential's environment, for links from n8n. */
export const portalUrlFor = (environment: unknown): string =>
	environment === 'development' ? 'https://dev.my.hitl.sh' : 'https://my.hitl.sh';

/** One answer a workflow's review step can give, as an n8n output. */
export interface Answer {
	value: string;
	label: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The answers a workflow's review steps offer: the options of single and multi select steps, and the two
 * labels of a yes or no step. Steps that take free text, a number or a rating have no fixed answers.
 */
export function workflowAnswers(nodes: unknown): Answer[] {
	const answers: Answer[] = [];
	const add = (value: string, label: string) => {
		if (value !== '' && !answers.some((a) => a.value === value)) answers.push({ value, label: label || value });
	};
	for (const node of Array.isArray(nodes) ? (nodes as IDataObject[]) : []) {
		if (node?.type !== 'review') continue;
		const data = (node.data ?? {}) as IDataObject;
		const config = (data.responseConfig ?? data.response_config ?? {}) as IDataObject;
		const type = text(data.responseType ?? data.response_type);
		if (type === 'boolean') {
			add('true', text(config.true_label ?? config.trueLabel) || 'Yes');
			add('false', text(config.false_label ?? config.falseLabel) || 'No');
		} else if (type === 'single_select' || type === 'multi_select') {
			for (const option of Array.isArray(config.options) ? config.options : []) {
				if (typeof option === 'string') add(option.trim(), option.trim());
				else if (option && typeof option === 'object') {
					const o = option as IDataObject;
					add(text(o.value) || text(o.label), text(o.label));
				}
			}
		}
	}
	return answers;
}

/** The answer a decision holds, as text: "approve", "true", "42". Undefined when there is none. */
export function answerValue(decision: unknown): string | undefined {
	if (typeof decision === 'string') return decision;
	if (typeof decision === 'boolean' || typeof decision === 'number') return String(decision);
	if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return undefined;
	const d = decision as IDataObject;
	for (const key of ['selected_value', 'value', 'boolean', 'number', 'rating']) {
		if (d[key] !== undefined && d[key] !== null && typeof d[key] !== 'object') return String(d[key]);
	}
	const many = d.selected_values;
	if (Array.isArray(many) && many.length > 0) return String(many[0]);
	return undefined;
}

/** Answer outputs are stored as JSON so the output names survive without asking the API. */
export const encodeAnswer = (answer: Answer): string => JSON.stringify({ v: answer.value, l: answer.label });

export function decodeAnswer(raw: unknown): Answer | undefined {
	if (typeof raw !== 'string') return undefined;
	try {
		const parsed = JSON.parse(raw) as { v?: unknown; l?: unknown };
		if (typeof parsed.v === 'string') return { value: parsed.v, label: typeof parsed.l === 'string' ? parsed.l : parsed.v };
	} catch {
		// a plain value typed by hand
	}
	return raw === '' ? undefined : { value: raw, label: raw };
}

/**
 * Which output a finished run goes to: the picked answer it matched, otherwise the last one (Other),
 * which also takes runs that failed, timed out or were still waiting when the node stopped waiting.
 */
export function outputFor(run: IDataObject, answers: Answer[]): number {
	const other = answers.length;
	if (run.finished !== true || run.status !== 'completed') return other;
	const value = answerValue(run.result);
	const index = answers.findIndex((a) => a.value === value);
	return index === -1 ? other : index;
}

/** A field path such as customer_email or customer.email as a label: "Customer email", "Customer › Email". */
export function fieldLabel(path: string): string {
	return path
		.split('.')
		.map((part) => {
			const words = part
				.replace(/[_-]+/g, ' ')
				.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
				.trim()
				.toLowerCase();
			return words.charAt(0).toUpperCase() + words.slice(1);
		})
		.join(' › ');
}

/** Turns {"customer.email": "a@b.co"} into {customer: {email: "a@b.co"}}. Values already nested are kept. */
export function nestInput(flat: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [path, value] of Object.entries(flat)) {
		const parts = path.split('.').filter(Boolean);
		if (parts.length === 0) continue;
		let at = out;
		for (const part of parts.slice(0, -1)) {
			const next = at[part];
			if (!next || typeof next !== 'object' || Array.isArray(next)) at[part] = {};
			at = at[part] as IDataObject;
		}
		at[parts[parts.length - 1]] = value;
	}
	return out;
}
