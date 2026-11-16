import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export const VYTO_PRODUCTION = 'https://zcyezroeuxkmfoiffgjm.supabase.co/functions/v1/api/v1';
export const VYTO_STAGING = 'https://fljdhwpdjfrhliwowlvq.supabase.co/functions/v1/api/v1';

export class VytoApi implements ICredentialType {
	name = 'vytoApi';

	displayName = 'Vyto API';

	icon: Icon = { light: 'file:../nodes/Vyto/vyto.svg', dark: 'file:../nodes/Vyto/vyto.dark.svg' };

	documentationUrl = 'https://github.com/coompanion/n8n-nodes-vyto#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'vyto_…',
			description:
				'Create a key in vyto under Settings → Integrations → API keys. Grant "read cases" for the trigger and search, "upload notices" for uploads.',
		},
		{
			displayName: 'Environment',
			name: 'baseUrl',
			type: 'options',
			default: VYTO_PRODUCTION,
			options: [
				{ name: 'vyto (app.vyto.ai)', value: VYTO_PRODUCTION },
				{ name: 'vyto Staging (testing only)', value: VYTO_STAGING },
			],
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
			baseURL: '={{$credentials.baseUrl}}',
			url: '/ping',
		},
	};
}
