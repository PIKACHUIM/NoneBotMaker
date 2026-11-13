import type { JsonObject, LibraryRecord } from '../../../shared/types';
import { boundedText, publicHttpsUrl, safeFetch, sanitize } from './network';
import { tool, validateToolArguments, type AgentTool } from './tools';

export interface CustomApiToolConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  method?: 'GET' | 'POST';
  readOnly?: boolean;
  /** Explicit, administrator-controlled exact host allowlist (no suffix or wildcard matching). */
  allowedHosts: string[];
  /** Administrator-supplied secret; never exposed to the model or tool output. */
  bearerToken?: string;
  properties: Record<string, { type: 'string' | 'number' | 'boolean'; maxLength?: number; enum?: Array<string | number | boolean> }>;
  required?: string[];
  enabled: boolean;
}

export interface CustomApiTool extends AgentTool {
  custom: { id: string; host: string; approvalRequired: boolean };
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const MAX_JSON_BYTES = 256 * 1024;

/** Only administrator-persisted configs should enter this factory; callers still gate identity grants and per-group approval. */
export function createCustomApiTools(configs: CustomApiToolConfig[], fetchImpl: typeof fetch = fetch): CustomApiTool[] {
  if (!Array.isArray(configs) || configs.length > 20) throw new Error('Too many custom tools.');
  if (configs.some((config) => !config || typeof config !== 'object' || typeof config.enabled !== 'boolean')) throw new Error('Invalid custom tool configuration.');
  const names = new Set<string>();
  return configs.filter((config) => config.enabled).map((config) => {
    if (typeof config.id !== 'string' || !TOOL_ID.test(config.id) || typeof config.name !== 'string' || !config.name || config.name.length > 100 || typeof config.description !== 'string' || config.description.length > 2000 || typeof config.url !== 'string') throw new Error('Invalid custom tool configuration.');
    if (config.method !== undefined && config.method !== 'POST' && config.method !== 'GET') throw new Error('Invalid custom tool method.');
    const method = config.method ?? 'POST';
    if (config.readOnly !== undefined && typeof config.readOnly !== 'boolean' || method === 'GET' && config.readOnly !== true || method === 'POST' && config.readOnly === true) throw new Error('Invalid custom tool read-only policy.');
    const name = `custom_${config.id}`;
    if (names.has(name)) throw new Error('Duplicate custom tool name.');
    names.add(name);
    const url = publicHttpsUrl(config.url);
    if (url.search || url.hash || !Array.isArray(config.allowedHosts) || !config.allowedHosts.length || config.allowedHosts.length > 20 ||
        config.allowedHosts.some((host) => typeof host !== 'string' || host !== host.toLowerCase() || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) ||
        !config.allowedHosts.includes(url.hostname.toLowerCase())) throw new Error('Custom tool endpoint is not on the exact host allowlist.');
    if (config.bearerToken !== undefined && (typeof config.bearerToken !== 'string' || !config.bearerToken || config.bearerToken.length > 4096 || /[\r\n]/.test(config.bearerToken))) throw new Error('Invalid custom tool credential.');
    const bearerToken = config.bearerToken;
    if (!config.properties || typeof config.properties !== 'object' || Array.isArray(config.properties) || Object.keys(config.properties).length > 20 || !Array.isArray(config.required ?? [])) throw new Error('Invalid custom tool argument allowlist.');
    const properties: JsonObject = {};
    for (const [key, spec] of Object.entries(config.properties)) {
      if (!IDENTIFIER.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || /secret|password|credential|authorization|api_?key|auth_?token|^(?:key|token|pass|auth)$/i.test(key) || !spec || !['string', 'number', 'boolean'].includes(spec.type) || spec.maxLength !== undefined && (spec.type !== 'string' || !Number.isSafeInteger(spec.maxLength) || spec.maxLength < 1 || spec.maxLength > 2048) ||
          spec.enum !== undefined && (!Array.isArray(spec.enum) || !spec.enum.length || spec.enum.length > 50 || spec.enum.some((item) => typeof item !== spec.type || typeof item === 'string' && item.length > 2048 || typeof item === 'number' && !Number.isFinite(item)))) throw new Error('Invalid custom tool argument schema.');
      properties[key] = { type: spec.type, ...(spec.type === 'string' ? { maxLength: spec.maxLength ?? 2048 } : {}), ...(spec.enum ? { enum: [...spec.enum] } : {}) };
    }
    const required = config.required ?? [];
    if (required.length > 20 || new Set(required).size !== required.length || required.some((key) => typeof key !== 'string' || !Object.hasOwn(properties, key))) throw new Error('Invalid custom tool required arguments.');
    const schema: JsonObject = { type: 'object', properties, required, additionalProperties: false };
    const registered = tool(name, config.description, properties, required, async (args) => {
      validateToolArguments(args, schema);
      if (new TextEncoder().encode(JSON.stringify(args)).byteLength > 16 * 1024) throw new Error('Custom tool arguments exceed size limit.');
      const target = new URL(url);
      if (method === 'GET') {
        for (const [key, value] of Object.entries(args)) target.searchParams.set(key, String(value));
        if (target.toString().length > 2048) throw new Error('Custom API URL exceeds size limit.');
      }
      let response: Response;
      try {
        response = await safeFetch(target.toString(), {
          method,
          headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), accept: 'application/json', ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}) },
          ...(method === 'GET' ? {} : { body: JSON.stringify(args) }),
        }, fetchImpl);
      } catch { throw new Error('Custom API request failed.'); } // Never surface remote diagnostics or credentials.
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        await response.body?.cancel();
        throw new Error('Custom API response must be JSON.');
      }
      let value: unknown;
      try { value = JSON.parse(await boundedText(response, MAX_JSON_BYTES)); }
      catch { throw new Error('Custom API response is invalid or too large.'); }
      if (value === null || typeof value !== 'object') throw new Error('Custom API response must be a JSON object or array.');
      return JSON.stringify({ untrusted: true, data: sanitize(value, bearerToken ? [bearerToken] : []) });
    });
    return { ...registered, custom: { id: config.id, host: url.hostname.toLowerCase(), approvalRequired: config.readOnly !== true } };
  });
}

/** Adapts administrator-saved `tools` records; builtin records are intentionally excluded. */
export function createCustomApiToolsFromRecords(records: LibraryRecord[], fetchImpl: typeof fetch = fetch): CustomApiTool[] {
  if (!Array.isArray(records) || records.length > 20) throw new Error('Too many custom tools.');
  const configs: CustomApiToolConfig[] = [];
  for (const record of records) {
    if (!record || typeof record.enabled !== 'boolean') throw new Error('Invalid custom tool record.');
    if (!record.enabled || record.config?.kind === 'builtin') continue;
    if (record.config?.kind !== 'https') throw new Error('Invalid custom tool kind.');
    const schema = record.config.parameterSchema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid custom tool argument schema.');
    const input = schema as JsonObject;
    if (Object.keys(input).some((key) => !['type', 'properties', 'required', 'additionalProperties', 'description', 'title'].includes(key)) ||
        input.type !== undefined && input.type !== 'object' || input.additionalProperties !== undefined && input.additionalProperties !== false ||
        input.properties !== undefined && (!input.properties || typeof input.properties !== 'object' || Array.isArray(input.properties))) throw new Error('Invalid custom tool argument schema.');
    const properties: CustomApiToolConfig['properties'] = {};
    for (const [key, value] of Object.entries(input.properties ?? {})) {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some((field) => !['type', 'maxLength', 'enum', 'description', 'title'].includes(field))) throw new Error('Invalid custom tool argument schema.');
      properties[key] = value as CustomApiToolConfig['properties'][string];
    }
    const url = record.config.url;
    if (typeof url !== 'string') throw new Error('Invalid custom tool endpoint.');
    const safeUrl = publicHttpsUrl(url);
    if (typeof record.id !== 'string' || !record.id || !/^[A-Za-z0-9_-]{1,128}$/.test(record.id)) throw new Error('Invalid custom tool identity.');
    configs.push({ id: record.id.slice(0, 48), name: record.name, description: record.description,
      enabled: true, url, allowedHosts: [safeUrl.hostname.toLowerCase()],
      method: record.config.method as CustomApiToolConfig['method'], readOnly: record.config.readOnly as boolean | undefined,
      bearerToken: record.config.authToken as string | undefined,
      properties, required: input.required as string[] | undefined });
  }
  return createCustomApiTools(configs, fetchImpl);
}
