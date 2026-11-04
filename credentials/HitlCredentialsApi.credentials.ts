import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class HitlCredentialsApi implements ICredentialType {
	name = 'hitlCredentialsApi';

	displayName = 'HITL.sh Human Approval API';

	icon: Icon = { light: 'file:hitl.svg', dark: 'file:hitl.dark.svg' };

	documentationUrl = 'https://docs.hitl.sh/integrations/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Your HITL.sh API key, from Settings in the platform',
		},
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			options: [
				{ name: 'Production', value: 'production', description: 'api.hitl.sh' },
				{ name: 'Development', value: 'development', description: 'dev.api.hitl.sh, for testing' },
			],
			default: 'production',
			description: 'Which HITL API to use. The key is only ever sent to these two hosts.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.environment === "development" ? "https://dev.api.hitl.sh" : "https://api.hitl.sh"}}',
			url: '/v1/test',
		},
	};
}
