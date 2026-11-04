import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';
import { HitlNodeV1 } from './v1/HitlNodeV1';
import { HitlNodeV3 } from './v3/HitlNodeV3';

/**
 * Version 1 is what n8n-nodes-human-in-the-loop 0.1.6 shipped: saved workflows keep using it.
 * Version 2 (a webhook URL field) was never published, so nothing can depend on it, and version 3
 * covers it by picking the workflow from a list. New nodes get version 3.
 */
export class HitlNode extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Human Approvals - HITL Platform',
			name: 'hitlNode',
			icon: 'file:hitl.svg',
			group: ['transform'],
			description: 'Run HITL workflows and ask people for approvals, then continue with their answer',
			defaultVersion: 3,
		};
		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new HitlNodeV1(baseDescription),
			3: new HitlNodeV3(baseDescription),
		};
		super(nodeVersions, baseDescription);
	}
}
