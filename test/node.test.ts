import { describe, expect, test } from 'vitest';
import type { INodeTypeBaseDescription } from 'n8n-workflow';
import { HitlCredentialsApi } from '../credentials/HitlCredentialsApi.credentials';
import { HitlNode } from '../nodes/HitlNode/HitlNode.node';

// What n8n-nodes-human-in-the-loop 0.1.6 saved in users' workflows.
const V1_PARAMETERS = ['resource', 'operation', 'loopId', 'processingType', 'contentType', 'requestText', 'responseType'];

describe('versions', () => {
	const node = new HitlNode();
	const description = node.description as INodeTypeBaseDescription;
	test('keeps its name, so saved workflows find it, and defaults to the new version', () => {
		expect(description.name).toBe('hitlNode');
		expect(description.defaultVersion).toBe(3);
		expect(Object.keys(node.nodeVersions).map(Number).sort()).toEqual([1, 3]);
	});
	test('version 1 keeps its fields', () => {
		const v1 = node.getNodeType(1).description;
		expect(v1.version).toBe(1);
		const names = v1.properties.map((p) => p.name);
		for (const name of V1_PARAMETERS) expect(names).toContain(name);
		expect(v1.webhooks).toBeUndefined();
	});
	test('version 3 can pause and works as a tool', () => {
		const v3 = node.getNodeType(3).description;
		expect(v3.usableAsTool).toBe(true);
		expect(v3.webhooks?.[0]).toMatchObject({ httpMethod: 'POST', restartWebhook: true, isFullPath: true });
		expect(v3.credentials?.[0]?.name).toBe('hitlCredentialsApi');
		expect(new Set(v3.properties.map((p) => p.type)).has('resourceLocator')).toBe(true);
	});
	test('version 3 builds its form from the workflow, and defaults to it', () => {
		const v3 = node.getNodeType(3);
		const mode = v3.description.properties.find((p) => p.name === 'inputMode');
		expect(mode?.default).toBe('fields');
		const form = v3.description.properties.find((p) => p.name === 'inputFields');
		expect(form?.typeOptions?.loadOptionsDependsOn).toEqual(['workflowId.value']);
		expect(typeof v3.methods?.resourceMapping?.[form!.typeOptions!.resourceMapper!.resourceMapperMethod!]).toBe('function');
	});
});

describe('credential', () => {
	const credential = new HitlCredentialsApi();
	test('has no free text host', () => {
		const names = credential.properties.map((p) => p.name);
		expect(names).toEqual(['apiKey', 'environment']);
		const environment = credential.properties[1]!;
		expect(environment.options?.map((o) => (o as { value: string }).value)).toEqual(['production', 'development']);
	});
	test('keeps its name, so saved credentials still work', () => {
		expect(credential.name).toBe('hitlCredentialsApi');
	});
});
