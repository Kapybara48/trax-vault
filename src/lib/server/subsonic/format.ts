import { SubsonicErrorCode, type SubsonicError } from './types.js';

const SUBSONIC_API_VERSION = '1.16.1';
const SERVER_VERSION = '1.0.0';
const SERVER_TYPE = 'traxvault';

function escapeXmlAttr(str: any): string {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeXmlText(str: any): string {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function objectToXml(tagName: string, obj: any, indent: string = '  '): string {
	if (obj === null || obj === undefined) return '';

	if (typeof obj !== 'object') {
		return `${indent}<${tagName}>${escapeXmlText(obj)}</${tagName}>\n`;
	}

	if (Array.isArray(obj)) {
		let xml = '';
		for (const item of obj) {
			xml += objectToXml(tagName, item, indent);
		}
		return xml;
	}

	const attrs: string[] = [];
	const children: string[] = [];
	let textContent: string | null = null;

	for (const [key, val] of Object.entries(obj)) {
		if (val === null || val === undefined) continue;

		if (key === 'value' || key === 'content' || key === '_text') {
			textContent = String(val);
		} else if (typeof val === 'object') {
			if (Array.isArray(val)) {
				// e.g. "song": [...]
				for (const item of val) {
					children.push(objectToXml(key, item, indent + '  '));
				}
			} else {
				children.push(objectToXml(key, val, indent + '  '));
			}
		} else {
			attrs.push(`${key}="${escapeXmlAttr(val)}"`);
		}
	}

	const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

	if (children.length === 0 && textContent === null) {
		return `${indent}<${tagName}${attrStr}/>\n`;
	}

	if (children.length === 0 && textContent !== null) {
		return `${indent}<${tagName}${attrStr}>${escapeXmlText(textContent)}</${tagName}>\n`;
	}

	let res = `${indent}<${tagName}${attrStr}>\n`;
	if (textContent !== null) {
		res += `${indent}  ${escapeXmlText(textContent)}\n`;
	}
	res += children.join('');
	res += `${indent}</${tagName}>\n`;
	return res;
}

/**
 * Format Subsonic success or error response in JSON or XML
 */
export function buildSubsonicResponse(
	data: Record<string, any> | null,
	format: string = 'xml',
	error?: SubsonicError,
	jsonpCallback?: string
): Response {
	const isJson = format.toLowerCase() === 'json' || format.toLowerCase() === 'jsonp';
	const status = error ? 'failed' : 'ok';

	const baseObj: Record<string, any> = {
		status,
		version: SUBSONIC_API_VERSION,
		type: SERVER_TYPE,
		serverVersion: SERVER_VERSION,
		openSubsonic: true
	};

	if (error) {
		baseObj.error = {
			code: error.code,
			message: error.message
		};
	} else if (data) {
		Object.assign(baseObj, data);
	}

	if (isJson) {
		const jsonBody = JSON.stringify({ 'subsonic-response': baseObj }, null, 2);
		const body = jsonpCallback ? `${jsonpCallback}(${jsonBody});` : jsonBody;
		const contentType = jsonpCallback ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8';

		return new Response(body, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': '*'
			}
		});
	}

	// XML Response
	let innerXml = '';
	if (error) {
		innerXml = `  <error code="${error.code}" message="${escapeXmlAttr(error.message)}"/>\n`;
	} else if (data) {
		for (const [key, val] of Object.entries(data)) {
			innerXml += objectToXml(key, val, '  ');
		}
	}

	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response xmlns="http://subsonic.org/restapi" status="${status}" version="${SUBSONIC_API_VERSION}" type="${SERVER_TYPE}" serverVersion="${SERVER_VERSION}" openSubsonic="true">\n${innerXml}</subsonic-response>`;

	return new Response(xml, {
		status: 200,
		headers: {
			'Content-Type': 'text/xml; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': '*'
		}
	});
}

export function buildSubsonicError(
	code: SubsonicErrorCode,
	message: string,
	format: string = 'xml',
	jsonpCallback?: string
): Response {
	return buildSubsonicResponse(null, format, { code, message }, jsonpCallback);
}
