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
			baseURL: 'https://api.hitl.sh',
			url: '/v1/test',
		},
	};
}
