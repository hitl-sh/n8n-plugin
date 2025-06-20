import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import { v4 as uuidv4 } from 'uuid';

const sleep = (ms: number) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		// wait
	}
};

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
			{
				displayName: 'Request Type',
				name: 'requestType',
				type: 'options',
				default: 'deffered',
				options: [
					{ name: 'Deffered', value: 'deffered' },
					{ name: 'Time-Sensitive', value: 'timeSensitive' },
				],
				description: 'Type of decision request',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				default: 'medium',
				options: [
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'High', value: 'high' },
					{ name: 'Urgent', value: 'urgent' },
				],
				description: 'Priority level for the request',
			},
			{
				displayName: 'Decision Context',
				name: 'context',
				type: 'json',
				default: '{}',
				required: true,
				description: 'JSON object with decision context for the human expert',
				typeOptions: {
					rows: 5,
				},
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 600,
				description: 'Maximum time to wait for a human response (for time-sensitive requests)',
				displayOptions: {
					show: {
						requestType: ['timeSensitive'],
					},
				},
			},
			{
				displayName: 'Default Action on Timeout',
				name: 'defaultAction',
				type: 'options',
				options: [
					{ name: 'Deny', value: 'deny' },
					{ name: 'Approve', value: 'approve' },
					{ name: 'None', value: 'none' },
				],
				default: 'deny',
				description: 'Action to take if the request times out',
				displayOptions: {
					show: {
						requestType: ['timeSensitive'],
					},
				},
			},
			{
				displayName: 'Assignee Role',
				name: 'assigneeRole',
				type: 'string',
				default: '',
				description: 'Role of the human assignee (optional)',
			},
			{
				displayName: 'Polling Interval (Seconds)',
				name: 'pollingInterval',
				type: 'number',
				default: 5,
				description: 'Interval between polling attempts (minimum 1 second)',
				typeOptions: {
					minValue: 1,
				},
			},
		],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const maxRequestsPerMinute = 100;
		const requestInterval = 60000 / maxRequestsPerMinute; //Throttle to 100 req/min
		const endpoint = 'http://localhost:8081/payment/requests';

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			this.logger.info('Item Info is this', item);
			const requestType = this.getNodeParameter('requestType', i) as string;
			const priority = this.getNodeParameter('priority', i) as string;
			const context = this.getNodeParameter('context', i) as string;
			const timeout = this.getNodeParameter('timeout', i) as number;
			const defaultAction = this.getNodeParameter('defaultAction', i) as string;
			const assigneeRole = this.getNodeParameter('assigneeRole', i) as string;
			const pollingInterval = this.getNodeParameter('pollingInterval', i) as number;

			//validate inputs
			let parsedContext;
			try {
				parsedContext = JSON.parse(context);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					'Invalid JSON format for context: ' + error.message,
				);
			}

			if (requestType === 'timeSensitive' && timeout <= 0) {
				throw new NodeOperationError(
					this.getNode(),
					'Timeout must be greater than 0 for time-sensitive requests',
				);
			}

			if (requestType === 'timeSensitive' && defaultAction === 'none') {
				throw new NodeOperationError(
					this.getNode(),
					'Default action cannot be "none" for time-sensitive requests',
				);
			}

			if (pollingInterval < 1) {
				throw new NodeOperationError(this.getNode(), 'Polling interval must be at least 1 second');
			}

			const requestId = uuidv4();

			const requestData = {
				requestType,
				priority,
				timeout: requestType === 'timeSensitive' ? timeout : undefined,
				context: parsedContext,
				assigneeRole: assigneeRole || undefined,
				requestId,
			};

			const options: IHttpRequestOptions = {
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				method: 'POST',
				body: {
					contacts: [requestData],
				},
				timeout: 30000,
				url: endpoint,
				json: true,
			};

			let response;
			let retries = 3;
			while (retries > 0) {
				try {
					response = await this.helpers.requestWithAuthentication.call(
						this,
						'hitlCredentialsApi',
						options,
					);
					break;
				} catch (error) {
					if (error.response?.status >= 500 && retries > 0) {
						retries--;
						sleep(2 ** (3 - retries) * 100);
						continue;
					}
					throw new NodeOperationError(this.getNode(), `Failed to send request: ${error.message}`);
				}
			}

			let resultsData = this.helpers.returnJsonArray(response as IDataObject[]);

			this.logger.info('Response', resultsData[0]);

			if (!response || response.status >= 400) {
				throw new NodeOperationError(
					this.getNode(),
					`Request failed with status ${response?.status || 'unknown'}`,
				);
			}
			const responseData: { status: string } = response.data;
			if (responseData?.status != 'pending') {
				throw new NodeOperationError(
					this.getNode(),
					`Unexpected response status: ${responseData.status}`,
				);
			}

			this.logger.info(`Sent HITL request: ${requestId}`, { requestData });

			//Poll for response
			let decision;
			const startTime = Date.now();
			const pollTimeout = requestType === 'timeSensitive' ? timeout * 1000 : Infinity;

			while (Date.now() - startTime < pollTimeout) {
				try {
					const statusResponse = await this.helpers.httpRequest({
						url: `${endpoint}/${requestId}`,
						headers: {
							headers: { Authorization: `Bearer ${this.getCredentials('hitlCredentialsApi')}` },
						},
						timeout: 30000,
					});
					const statusData = statusResponse.data;
					if (statusData.status === 'completed') {
						decision = statusData;
						break;
					}

					sleep(Math.max(pollingInterval * 1000, requestInterval));
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Polling error for request ${requestId}: '${error.message}`,
					);
				}
			}

			// Handle timeout
			if (!decision && requestType === 'timeSensitive') {
				decision = {
					requestId,
					status: 'timeout',
					response: defaultAction,
					responseTime: Date.now() / 1000,
				};
				this.logger.warn(
					`Request ${requestId} timed out; applying default action: ${defaultAction}`,
				);
			} else if (!decision) {
				throw new NodeOperationError(
					this.getNode(),
					`No response received for request ${requestId}`,
				);
			}

			// Log response
			this.logger.info(`Received HITL response for request ${requestId}`, { decision });

			// Prepare output
			returnData.push({
				json: {
					decision: {
						status: decision.status || 'unknown',
						response: decision.response || '',
						responseTime: decision.responseTime || 0,
					},
					auditTrail: {
						requestId: decision.requestId || '',
						status: decision.status || 'unknown',
						responseTime: decision.responseTime || 0,
					},
				},
			});
		}
		//logic comes here

		return [returnData];
	}
}
