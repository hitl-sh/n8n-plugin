import { describe, expect, test } from 'vitest';
import {
	answerValue,
	decodeAnswer,
	encodeAnswer,
	fieldLabel,
	nestInput,
	outputFor,
	portalUrlFor,
	workflowAnswers,
} from '../nodes/HitlNode/v3/logic';
import { configuredOutputs } from '../nodes/HitlNode/v3/HitlNodeV3';
import { HitlNode } from '../nodes/HitlNode/HitlNode.node';

const review = (responseType: string, responseConfig: object, label = 'Review') => ({
	id: `review-${label}`,
	type: 'review',
	data: { label, responseType, responseConfig },
});

describe('workflowAnswers', () => {
	test('select options, deduped across steps', () => {
		const nodes = [
			{ id: 'trigger-1', type: 'trigger', data: {} },
			review('single_select', {
				options: [
					{ value: 'approve', label: 'Approve' },
					{ value: 'reject', label: 'Reject' },
				],
			}),
			review('multi_select', { options: ['reject', 'escalate'] }, 'Second'),
		];
		expect(workflowAnswers(nodes)).toEqual([
			{ value: 'approve', label: 'Approve' },
			{ value: 'reject', label: 'Reject' },
			{ value: 'escalate', label: 'escalate' },
		]);
	});
	test('yes or no steps use their labels', () => {
		expect(workflowAnswers([review('boolean', { true_label: 'Pay it', false_label: 'Hold' })])).toEqual([
			{ value: 'true', label: 'Pay it' },
			{ value: 'false', label: 'Hold' },
		]);
		expect(workflowAnswers([review('boolean', {})]).map((a) => a.label)).toEqual(['Yes', 'No']);
	});
	test('free text, numbers and ratings have no fixed answers', () => {
		expect(workflowAnswers([review('text', {}), review('number', {}), review('rating', {})])).toEqual([]);
		expect(workflowAnswers(undefined)).toEqual([]);
	});
});

describe('answerValue', () => {
	test.each([
		['approve', 'approve'],
		[true, 'true'],
		[{ selected_value: 'reject', selected_label: 'Reject' }, 'reject'],
		[{ boolean: false, boolean_label: 'Hold' }, 'false'],
		[{ value: 'x' }, 'x'],
		[{ number: 42 }, '42'],
		[{ selected_values: ['a', 'b'] }, 'a'],
		[null, undefined],
		[{}, undefined],
	])('%j → %s', (decision, expected) => {
		expect(answerValue(decision)).toBe(expected);
	});
});

describe('outputFor', () => {
	const answers = [
		{ value: 'approve', label: 'Approve' },
		{ value: 'reject', label: 'Reject' },
	];
	test('a matching answer goes to its output', () => {
		expect(outputFor({ finished: true, status: 'completed', result: { selected_value: 'reject' } }, answers)).toBe(1);
	});
	test('anything else goes to Other', () => {
		expect(outputFor({ finished: true, status: 'completed', result: { selected_value: 'escalate' } }, answers)).toBe(2);
		expect(outputFor({ finished: true, status: 'timed_out', result: null }, answers)).toBe(2);
		expect(outputFor({ finished: false, status: 'pending_review', stopped_waiting: true }, answers)).toBe(2);
	});
});

describe('answer encoding', () => {
	test('round trips, and takes plain values typed by hand', () => {
		const answer = { value: 'approve', label: 'Approve' };
		expect(decodeAnswer(encodeAnswer(answer))).toEqual(answer);
		expect(decodeAnswer('approve')).toEqual({ value: 'approve', label: 'approve' });
		expect(decodeAnswer('')).toBeUndefined();
	});
});

describe('fields', () => {
	test('labels', () => {
		expect(fieldLabel('vendor_name')).toBe('Vendor name');
		expect(fieldLabel('invoiceTotal')).toBe('Invoice total');
		expect(fieldLabel('customer.email')).toBe('Customer › Email');
	});
	test('dotted paths become nested input', () => {
		expect(nestInput({ 'customer.email': 'a@b.co', 'customer.name': 'Ada', amount: 12 })).toEqual({
			customer: { email: 'a@b.co', name: 'Ada' },
			amount: 12,
		});
	});
	test('portal links follow the environment', () => {
		expect(portalUrlFor('development')).toBe('https://dev.my.hitl.sh');
		expect(portalUrlFor('production')).toBe('https://my.hitl.sh');
	});
});

describe('outputs', () => {
	const approve = encodeAnswer({ value: 'approve', label: 'Approve' });
	const reject = encodeAnswer({ value: 'reject', label: 'Reject' });
	test('one output unless answers are picked on a waiting run', () => {
		expect(configuredOutputs({})).toEqual([{ type: 'main' }]);
		expect(configuredOutputs({ answerOutputs: [approve], waitMode: 'none' })).toHaveLength(1);
		expect(configuredOutputs({ answerOutputs: [approve], resource: 'run', operation: 'get' })).toHaveLength(1);
	});
	test('picked answers, then Other', () => {
		expect(configuredOutputs({ answerOutputs: [approve, reject] }).map((o) => o.displayName)).toEqual([
			'Approve',
			'Reject',
			'Other',
		]);
	});
	test('the expression n8n evaluates works on its own', () => {
		const expression = new HitlNode().getNodeType(3).description.outputs as string;
		expect(expression.startsWith('={{(')).toBe(true);
		const source = expression.slice(3, -2);
		// n8n evaluates the text without the module around it, so nothing outside the function may be used.
		const evaluate = new Function('$parameter', `return ${source};`);
		expect(evaluate({ answerOutputs: [approve, reject] }).map((o: { displayName: string }) => o.displayName)).toEqual([
			'Approve',
			'Reject',
			'Other',
		]);
	});
});
