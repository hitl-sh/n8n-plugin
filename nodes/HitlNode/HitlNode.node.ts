import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

export class HitlNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HITL Platform',
		icon: 'file:hitl.svg',
		name: 'hitlNode',
		group: ['transform'],
		version: 1,
		description: 'Integrates with the HITL Platform for human-in-the-loop decisions',
		defaults: {
			name: 'HITL Platform',
		},
		credentials: [
			{
				name: 'hitlCredentialsApi',
				required: true,
			},
		],
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		properties: [
			// Node properties which the user gets displayed and
			// can change on the node.
			{
				displayName: 'Api Endpoint',
				name: 'endpoint',
				type: 'string',
				default: 'https://api.hitl-platform.com/decisions',
				required: true,
				description: 'The HITL Platform API endpoint for decision requests',
			},
			{
				displayName: 'Decision Context',
				name: 'context',
				type: 'json',
				default: '{}',
				required: true,
				description: 'JSON object with decision context for the human expert',
			},
			{
				displayName: 'Urgency Level',
				name: 'urgency',
				type: 'options',
				options: [
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'High', value: 'high' },
				],
				default: 'medium',
				description: 'Urgency level for the decision request',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 300,
				description: 'Maximum time to wait for a human response',
			},
		],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		//logic comes here

		return [items];
	}
}
