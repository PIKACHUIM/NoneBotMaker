import type { JsonObject } from '../../../shared/types';
import { tool, type AgentTool } from './tools';

const MAX_EXPRESSION_CHARS = 256;
const MAX_TOKENS = 128;

function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) throw new Error('Random range is invalid.');
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % maxExclusive;
  }
}

function tokenize(expression: string): string[] {
  if (!expression || expression.length > MAX_EXPRESSION_CHARS) throw new Error('Expression is empty or too long.');
  const compact = expression.replace(/\s+/g, '');
  if (!/^[-+*/%^().\d]+$/.test(compact)) throw new Error('Expression may only contain numbers, + - * / % ^ and parentheses.');
  const tokens = compact.match(/\d+(?:\.\d+)?|\.\d+|[-+*/%^()]/g);
  if (!tokens || tokens.join('') !== compact) throw new Error('Expression is invalid.');
  if (tokens.length > MAX_TOKENS) throw new Error('Expression has too many tokens.');
  return tokens;
}

function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  let index = 0;

  function primary(): number {
    const token = tokens[index];
    if (token === '(') {
      index += 1;
      const value = sum();
      if (tokens[index] !== ')') throw new Error('Missing closing parenthesis.');
      index += 1;
      return value;
    }
    if (token === undefined || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) throw new Error('Expected a number.');
    index += 1;
    return Number(token);
  }

  function power(): number {
    const base = primary();
    if (tokens[index] !== '^') return base;
    index += 1;
    const exponent = unary();
    const value = base ** exponent;
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error('Result is outside the supported range.');
    return value;
  }

  function unary(): number {
    if (tokens[index] === '+') { index += 1; return unary(); }
    if (tokens[index] === '-') { index += 1; return -unary(); }
    return power();
  }

  function product(): number {
    let value = unary();
    while (['*', '/', '%'].includes(tokens[index] ?? '')) {
      const operator = tokens[index];
      index += 1;
      const right = unary();
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('Division by zero is not allowed.');
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
      if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error('Result is outside the supported range.');
    }
    return value;
  }

  function sum(): number {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index];
      index += 1;
      const right = product();
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error('Result is outside the supported range.');
    }
    return value;
  }

  const result = sum();
  if (index !== tokens.length) throw new Error('Expression contains unsupported syntax.');
  return result;
}

function utf8Base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

/** Local, side-effect-free helpers available to every conversation when granted. */
export function createUtilityTools(): AgentTool[] {
  return [
    tool('chat_calculate', '计算纯算术表达式，支持 + - * / % ^ 与括号；不执行变量、函数或任何代码。', {
      expression: { type: 'string', minLength: 1, maxLength: MAX_EXPRESSION_CHARS },
    }, ['expression'], async (args) => {
      const expression = String(args.expression);
      const result = evaluateExpression(expression);
      return JSON.stringify({ expression, result });
    }),
    tool('chat_random', '生成安全的随机整数、小数、骰子结果或从选项中抽取一项。', {
      type: { type: 'string', enum: ['integer', 'decimal', 'dice', 'choice'] },
      min: { type: 'number' },
      max: { type: 'number' },
      count: { type: 'integer', minimum: 1, maximum: 20 },
      sides: { type: 'integer', minimum: 2, maximum: 1000 },
      choices: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 200 } },
    }, ['type'], async (args) => {
      const type = String(args.type);
      if (type === 'integer') {
        const min = Number.isSafeInteger(args.min) ? Number(args.min) : 0;
        const max = Number.isSafeInteger(args.max) ? Number(args.max) : 100;
        if (min > max || max - min > 2 ** 31) throw new Error('Integer range is invalid.');
        return JSON.stringify({ type, min, max, value: min + secureRandomInt(max - min + 1) });
      }
      if (type === 'decimal') {
        const min = typeof args.min === 'number' && Number.isFinite(args.min) ? args.min : 0;
        const max = typeof args.max === 'number' && Number.isFinite(args.max) ? args.max : 1;
        if (min > max) throw new Error('Decimal range is invalid.');
        return JSON.stringify({ type, min, max, value: min + (max - min) * (secureRandomInt(2 ** 32) / 2 ** 32) });
      }
      if (type === 'dice') {
        const sides = Number.isSafeInteger(args.sides) ? Number(args.sides) : 6;
        const count = Number.isSafeInteger(args.count) ? Number(args.count) : 1;
        if (sides < 2 || sides > 1000 || count < 1 || count > 20) throw new Error('Dice configuration is invalid.');
        const rolls = Array.from({ length: count }, () => 1 + secureRandomInt(sides));
        return JSON.stringify({ type, sides, count, rolls, total: rolls.reduce((total, value) => total + value, 0) });
      }
      if (type === 'choice') {
        const choices = Array.isArray(args.choices) ? args.choices.map(String) : [];
        if (!choices.length || choices.length > 50) throw new Error('Choice list is empty or too long.');
        return JSON.stringify({ type, value: choices[secureRandomInt(choices.length)], choices: choices.length });
      }
      throw new Error('Random type is unsupported.');
    }),
    tool('chat_uuid', '生成一个 UUID v4 字符串。', {}, [], async () => JSON.stringify({ uuid: crypto.randomUUID() })),
    tool('chat_base64', '对 UTF-8 文本进行 Base64 编码或解码；解码只接受有效文本。', {
      action: { type: 'string', enum: ['encode', 'decode'] },
      text: { type: 'string', minLength: 1, maxLength: 16_384 },
    }, ['action', 'text'], async (args) => {
      const text = String(args.text);
      if (args.action === 'encode') {
        return JSON.stringify({ action: 'encode', result: utf8Base64(new TextEncoder().encode(text)) });
      }
      const compact = text.replace(/\s+/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) throw new Error('Base64 text is invalid.');
      const bytes = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
      let decoded: string;
      try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('Base64 payload is not valid UTF-8 text.'); }
      return JSON.stringify({ action: 'decode', result: decoded });
    }),
    tool('chat_hash', '计算文本的 SHA-256、SHA-384 或 SHA-512 十六进制摘要。', {
      algorithm: { type: 'string', enum: ['sha256', 'sha384', 'sha512'] },
      text: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['algorithm', 'text'], async (args) => {
      const algorithm = String(args.algorithm);
      const names = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' } as const;
      const name = names[algorithm as keyof typeof names];
      if (!name) throw new Error('Hash algorithm is unsupported.');
      const digest = await crypto.subtle.digest(name, new TextEncoder().encode(String(args.text)));
      return JSON.stringify({ algorithm, hex: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') });
    }),
    tool('chat_text_stats', '统计文本的字符数、UTF-8 字节数、单词数和行数。', {
      text: { type: 'string', maxLength: 32_768 },
    }, ['text'], async (args) => {
      const text = String(args.text);
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      return JSON.stringify({
        characters: Array.from(text).length,
        bytes: new TextEncoder().encode(text).byteLength,
        words,
        lines: text ? text.split(/\r?\n/).length : 0,
      });
    }),
  ];
}

/** Exported for unit tests; not part of the model-facing tool catalog. */
export function calculateExpression(expression: string): number {
  return evaluateExpression(expression);
}

/** Exported for unit tests. */
export function randomInteger(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || max - min > 2 ** 31) throw new Error('Integer range is invalid.');
  return min + secureRandomInt(max - min + 1);
}

export type UtilityToolArguments = JsonObject;
