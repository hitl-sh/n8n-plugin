import { describe, expect, test } from 'vitest';
import {
	baseUrlFor,
	callbackId,
	chooseWait,
	isReachableUrl,
	parseObject,
	pollUntil,
	requestFinished,
	runFinished,
	unwrap,
} from '../nodes/HitlNode/v3/logic';

const fail = (error: unknown): never => {
	throw error;
};
const failMessage = (message: string): never => {
	throw new Error(message);
};

describe('baseUrlFor', () => {
	test('only ever the two hosts', () => {
		expect(baseUrlFor('development')).toBe('https://dev.api.hitl.sh/v1');
		for (const other of ['production', undefined, 'https://evil.example', '']) {
			expect(baseUrlFor(other)).toBe('https://api.hitl.sh/v1');
		}
	});
});

describe('isReachableUrl', () => {
	test.each([
		['https://n8n.example.com/webhook-waiting/1/x?signature=a', true],
		['http://n8n.example.com/x', false],
		['https://localhost:5678/x', false],
		['https://127.0.0.1/x', false],
		['https://10.0.0.4/x', false],
		['https://192.168.1.2/x', false],
		['https://172.20.0.2/x', false],
		['https://n8n.local/x', false],
		['https://n8n/x', false],
		['not a url', false],
		[undefined, false],
	])('%s -> %s', (url, reachable) => {
		expect(isReachableUrl(url)).toBe(reachable);
	});
});

describe('chooseWait', () => {
	const open = 'https://n8n.example.com/w/1';
	test('automatic uses a callback only when it can work', () => {
		expect(chooseWait('auto', { resumeUrl: open, itemCount: 1, isTool: false }).wait).toBe('callback');
		expect(chooseWait('auto', { resumeUrl: 'http://localhost:5678/w', itemCount: 1, isTool: false }).wait).toBe('poll');
		expect(chooseWait('auto', { resumeUrl: open, itemCount: 2, isTool: false }).wait).toBe('poll');
		expect(chooseWait('auto', { resumeUrl: open, itemCount: 1, isTool: true }).wait).toBe('poll');
		expect(chooseWait('auto', { itemCount: 1, isTool: false }).wait).toBe('poll');
	});
	test('asking for a callback where it cannot work says why', () => {
		expect(chooseWait('callback', { resumeUrl: open, itemCount: 1, isTool: false }).problem).toBeUndefined();
		expect(chooseWait('callback', { resumeUrl: open, itemCount: 2, isTool: false }).problem).toMatch(/one item/);
		expect(chooseWait('callback', { resumeUrl: open, itemCount: 1, isTool: true }).problem).toMatch(/AI tool/);
		expect(chooseWait('callback', { resumeUrl: 'http://localhost/w', itemCount: 1, isTool: false }).problem).toMatch(/public https/);
	});
	test('poll and none are taken as they are', () => {
		expect(chooseWait('poll', { itemCount: 5, isTool: true })).toEqual({ wait: 'poll' });
		expect(chooseWait('none', { itemCount: 5, isTool: true })).toEqual({ wait: 'none' });
	});
});

describe('parseObject', () => {
	test('objects and JSON text', () => {
		expect(parseObject('{"a":1}', 'Input', failMessage)).toEqual({ a: 1 });
		expect(parseObject({ a: 1 }, 'Input', failMessage)).toEqual({ a: 1 });
		expect(parseObject('  ', 'Input', failMessage)).toEqual({});
	});
	test('refuses anything else', () => {
		expect(() => parseObject('{nope', 'Input', failMessage)).toThrow(/Input is not valid JSON/);
		expect(() => parseObject('[1]', 'Input', failMessage)).toThrow(/must be a JSON object/);
		expect(() => parseObject('3', 'Input', failMessage)).toThrow(/must be a JSON object/);
	});
});

describe('answers', () => {
	test('unwrap', () => {
		expect(unwrap({ error: false, data: { id: 'x' } })).toEqual({ id: 'x' });
		expect(unwrap({ id: 'x' })).toEqual({ id: 'x' });
		expect(unwrap(undefined)).toEqual({});
	});
	test('finished', () => {
		expect(runFinished({ finished: true })).toBe(true);
		expect(runFinished({ status: 'pending_review', finished: false })).toBe(false);
		for (const status of ['completed', 'timeout', 'cancelled']) expect(requestFinished({ status })).toBe(true);
		for (const status of ['pending', 'claimed', 'held']) expect(requestFinished({ status })).toBe(false);
	});
	test('callbackId takes only well formed ids', () => {
		const id = '6727aaaaaaaaaaaaaaaaaaaa';
		expect(callbackId('workflow', { execution: { id } })).toBe(id);
		expect(callbackId('request', { request_id: id })).toBe(id);
		expect(callbackId('workflow', { request_id: id })).toBeUndefined();
		expect(callbackId('workflow', { execution: { id: '../../admin' } })).toBeUndefined();
		expect(callbackId('request', {})).toBeUndefined();
	});
});

describe('pollUntil', () => {
	const noSleep = async () => {};
	test('returns as soon as it is done', async () => {
		const answers = [{ finished: false }, { finished: false }, { finished: true, id: 'r' }];
		let reads = 0;
		const result = await pollUntil(async () => (reads++, answers.shift()!), runFinished, { maxMs: 1000, sleep: noSleep, fail });
		expect(result).toEqual({ value: { finished: true, id: 'r' }, finished: true });
		expect(reads).toBe(3);
	});
	test('gives up at the deadline with the last answer', async () => {
		let clock = 0;
		const result = await pollUntil(async () => ({ status: 'pending_review', finished: false }), runFinished, {
			maxMs: 100,
			now: () => clock,
			sleep: async () => void (clock += 60),
			fail,
		});
		expect(result.finished).toBe(false);
		expect(result.value.status).toBe('pending_review');
		expect(clock).toBeLessThan(200);
	});
	test('retries server errors, then stops', async () => {
		let reads = 0;
		await expect(
			pollUntil(async () => { reads++; throw { statusCode: 503, message: 'down' }; }, runFinished, { maxMs: 1e6, sleep: noSleep, fail, maxFailures: 3 }),
		).rejects.toMatchObject({ statusCode: 503 });
		expect(reads).toBe(3);
	});
	test('a good answer resets the count of failures', async () => {
		const steps: Array<() => object> = [
			() => { throw { statusCode: 500 }; },
			() => ({ finished: false }),
			() => { throw { statusCode: 500 }; },
			() => ({ finished: true }),
		];
		const result = await pollUntil(async () => steps.shift()!() as never, runFinished, { maxMs: 1e6, sleep: noSleep, fail, maxFailures: 2 });
		expect(result.finished).toBe(true);
	});
	test('a 4xx stops at once', async () => {
		let reads = 0;
		await expect(
			pollUntil(async () => { reads++; throw { response: { status: 401 } }; }, runFinished, { maxMs: 1e6, sleep: noSleep, fail }),
		).rejects.toBeDefined();
		expect(reads).toBe(1);
	});
});
