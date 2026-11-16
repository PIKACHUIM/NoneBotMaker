import { describe, expect, it } from 'vitest';
import { calculateExpression, createUtilityTools, randomInteger } from './utility-tools';

function findTool(name: string) {
  const entry = createUtilityTools().find((tool) => tool.definition.function.name === name);
  if (!entry) throw new Error(`Missing tool ${name}`);
  return entry;
}

describe('local utility tools', () => {
  it('evaluates arithmetic with precedence, parentheses and unary signs', () => {
    expect(calculateExpression('2 + 3 * 4')).toBe(14);
    expect(calculateExpression('(2 + 3) * 4')).toBe(20);
    expect(calculateExpression('2 ^ 3 ^ 2')).toBe(512);
    expect(calculateExpression('-4 + 10 / 2')).toBe(1);
    expect(() => calculateExpression('1 / 0')).toThrow('zero');
    expect(() => calculateExpression('alert(1)')).toThrow();
  });

  it('returns random values inside the requested bounds', () => {
    for (let index = 0; index < 20; index += 1) {
      const value = randomInteger(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('exposes calculator, random, UUID, Base64, hash and text statistics', async () => {
    expect(JSON.parse(await findTool('chat_calculate').execute({ expression: '6 * 7' }))).toMatchObject({ result: 42 });
    const random = JSON.parse(await findTool('chat_random').execute({ type: 'dice', sides: 6, count: 3 }));
    expect(random.rolls).toHaveLength(3);
    expect(JSON.parse(await findTool('chat_uuid').execute({})).uuid).toMatch(/^[0-9a-f-]{36}$/i);
    const encoded = JSON.parse(await findTool('chat_base64').execute({ action: 'encode', text: '你好' }));
    const decoded = JSON.parse(await findTool('chat_base64').execute({ action: 'decode', text: encoded.result }));
    expect(decoded.result).toBe('你好');
    const hashed = JSON.parse(await findTool('chat_hash').execute({ algorithm: 'sha256', text: 'abc' }));
    expect(hashed.hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(JSON.parse(await findTool('chat_text_stats').execute({ text: 'one two\nthree' }))).toMatchObject({ words: 3, lines: 2, bytes: 13 });
  });
});
