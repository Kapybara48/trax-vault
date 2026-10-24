export enum SubsonicErrorCode {
	GENERIC = 0,
	REQUIRED_PARAM_MISSING = 10,
	INCOMPATIBLE_PROTOCOL = 20,
	INCOMPATIBLE_SERVER = 30,
	WRONG_CREDENTIALS = 40,
	TOKEN_NOT_SUPPORTED = 41,
	NOT_AUTHORIZED = 50,
	TRIAL_EXPIRED = 60,
	DATA_NOT_FOUND = 70
}

export interface SubsonicError {
	code: SubsonicErrorCode;
	message: string;
}

export interface SubsonicResponseOptions {
	status?: 'ok' | 'failed';
	version?: string;
	error?: SubsonicError;
	[key: string]: any;
}
