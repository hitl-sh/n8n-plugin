import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';



export class HitlNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HITL Workflow',
		icon: 'file:hitl.svg',
		name: 'hitlNode',
		group: ['transform'],
		version: 2,
		description: 'Trigger a HITL workflow via webhook and wait for the human review result',
		defaults: {
			name: 'HITL Workflow',
		},
		subtitle: 'Workflow trigger + wait',
		credentials: [
			{
				name: 'hitlCredentialsApi',
				required: true,
			},
		],
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://api.hitl.sh/v1/workflows/webhook/your-webhook-id',
				description:
					'The webhook URL from your activated HITL workflow. Find it in the HITL workflow designer.',
			},
			{
				displayName: 'JSON Payload',
				name: 'jsonPayload',
				type: 'json',
				required: true,
				default: '{}',
				description: 'The JSON data to send to the HITL workflow',
				typeOptions: {
					rows: 6,
				},
			},
			{
				displayName: 'Processing Type',
				name: 'processingType',
				type: 'options',
				default: 'deferred',
				options: [
					{ name: 'Deferred', value: 'deferred' },
					{ name: 'Time-Sensitive', value: 'time-sensitive' },
				],
				description: 'Whether this request is time-sensitive or can be handled later',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeoutSeconds',
				type: 'number',
				displayOptions: {
					show: {
						processingType: ['time-sensitive'],
					},
				},
				default: 600,
				description: 'Timeout in seconds for time-sensitive requests (60-86400)',
				typeOptions: {
					minValue: 60,
					maxValue: 86400,
				},
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				description:
					'Whether to wait for the HITL workflow to complete before continuing. If false, returns immediately with the execution ID.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const webhookUrl = this.getNodeParameter('webhookUrl', i) as string;
				const jsonPayloadRaw = this.getNodeParameter('jsonPayload', i) as string;
				const processingType = this.getNodeParameter('processingType', i) as string;
				const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;

				if (!webhookUrl || !webhookUrl.trim()) {
					throw new NodeOperationError(this.getNode(), 'Webhook URL is required');
				}

				// Validate the webhook URL format
				if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
					throw new NodeOperationError(
						this.getNode(),
						'Webhook URL must start with http:// or https://',
					);
				}

				// Parse the JSON payload
				let parsedPayload: any;
				try {
					parsedPayload =
						typeof jsonPayloadRaw === 'string' ? JSON.parse(jsonPayloadRaw) : jsonPayloadRaw;
				} catch (error: any) {
					throw new NodeOperationError(
						this.getNode(),
						`Invalid JSON payload: ${error.message}`,
					);
				}

				// Build the webhook request body
				const body: any = {
					...parsedPayload,
					processing_type: processingType,
					platform: 'n8n',
					platform_version: '2.0.0',
				};

				// Add timeout for time-sensitive requests
				if (processingType === 'time-sensitive') {
					const timeoutSeconds = this.getNodeParameter('timeoutSeconds', i) as number;
					body.timeout_seconds = timeoutSeconds;
				}

				// POST to the webhook URL
				const credentials = await this.getCredentials('hitlCredentialsApi');
				const postOptions: IHttpRequestOptions = {
					method: 'POST',
					url: webhookUrl.trim(),
					headers: {
						Authorization: `Bearer ${credentials.apiKey}`,
						'Content-Type': 'application/json',
					},
					body,
					json: true,
				};

				const response = await this.helpers.httpRequest(postOptions);

				if (response.error === true) {
					throw new NodeOperationError(
						this.getNode(),
						`Webhook error: ${response.msg || 'Unknown error'}${response.data ? ' - ' + JSON.stringify(response.data) : ''}`,
					);
				}

				// Extract IDs from the webhook response
				const executionId = response.data?.execution_id || response.execution_id;
				const requestId = response.data?.request_id || response.request_id;

				if (!waitForCompletion) {
					// Return immediately with execution info
					returnData.push({
						json: {
							execution_id: executionId,
							request_id: requestId,
							status: 'triggered',
							message: 'Workflow triggered successfully, not waiting for completion',
							webhook_response: response.data || response,
						},
						pairedItem: { item: i },
					});
					continue;
				}

				// Poll for completion
				if (!requestId) {
					throw new NodeOperationError(
						this.getNode(),
						'Webhook response did not include a request_id. Cannot poll for completion.',
					);
				}

				const pollingUrl = `${credentials.baseUrl}/v1/api/requests/${requestId}`;
				const pollInterval = 5000; // 5 seconds
				const startTime = Date.now();
				let pollCount = 0;
				let hitlResponse: any = null;
				let isCompleted = false;

				while (!isCompleted) {
					// Wait before polling
					const endTime = Date.now() + pollInterval;
					while (Date.now() < endTime) {
						await new Promise((resolve) => resolve(null));
					}

					pollCount++;

					try {
						const pollOptions: IHttpRequestOptions = {
							method: 'GET',
							url: pollingUrl,
							headers: {
								Authorization: `Bearer ${credentials.apiKey}`,
								'Content-Type': 'application/json',
							},
							json: true,
						};

						hitlResponse = await this.helpers.httpRequest(pollOptions);

						if (hitlResponse.error) {
							throw new NodeOperationError(
								this.getNode(),
								`Polling error: ${hitlResponse.msg || 'Unknown error'}`,
							);
						}

						const status =
							hitlResponse.data?.request?.status || hitlResponse.data?.status;

						if (
							status === 'completed' ||
							status === 'answered' ||
							status === 'resolved' ||
							status === 'failed' ||
							status === 'timeout' ||
							status === 'cancelled'
						) {
							isCompleted = true;
						}

						// Also check if there's a response_data field indicating completion
						const responseData =
							hitlResponse.data?.request?.response_data ||
							hitlResponse.data?.response_data;
						if (responseData !== undefined && responseData !== null) {
							isCompleted = true;
						}
					} catch (pollError: any) {
						// Continue polling on transient errors
						// Backend handles timeouts, so we keep polling
					}
				}

				// Extract response data
				const finalStatus =
					hitlResponse.data?.request?.status || hitlResponse.data?.status || 'completed';
				const totalElapsedSeconds = Math.round((Date.now() - startTime) / 1000);
				const finalResponse =
					hitlResponse.data?.request?.response_data || hitlResponse.data?.response_data;
				const responseBy = hitlResponse.data?.request?.response_by_user;

				const waitMessage =
					finalStatus === 'timeout'
						? `Request timed out after ${totalElapsedSeconds}s`
						: finalStatus === 'completed' || finalStatus === 'answered'
							? `Human response received after ${totalElapsedSeconds}s`
							: `Request ${finalStatus} after ${totalElapsedSeconds}s`;

				returnData.push({
					json: {
						request_id: requestId,
						execution_id: executionId,
						status: finalStatus,
						response: finalResponse,
						response_by: responseBy,
						response_time_seconds:
							hitlResponse.data?.request?.response_time_seconds,
						message: waitMessage,
						wait_info: {
							total_wait_time_seconds: totalElapsedSeconds,
							polling_cycles: pollCount,
							processing_type: processingType,
							was_timeout: finalStatus === 'timeout',
						},
						full_response: hitlResponse.data?.request || hitlResponse.data,
					},
					pairedItem: { item: i },
				});
			} catch (error: any) {
				let errorMessage = error.message;
				if (error.response?.data) {
					try {
						const apiError = error.response.data;
						errorMessage += ` | API Response: ${JSON.stringify(apiError)}`;
					} catch (e) {
						errorMessage += ` | API Response: ${error.response.data}`;
					}
				}
				if (error.response?.status) {
					errorMessage = `HTTP ${error.response.status}: ${errorMessage}`;
				}

				if (this.continueOnFail()) {
					returnData.push({ json: { error: errorMessage } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), errorMessage);
			}
		}

		return [returnData];
	}
}
