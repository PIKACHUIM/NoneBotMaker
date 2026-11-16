import { describe, expect, it } from 'vitest';
import { parseChatCommand, renderCommandPrompt, renderScheduleText } from './commands';

describe('chat command parsing', () => {
  it('parses names and arguments', () => {
    expect(parseChatCommand('/status')).toEqual({ name: 'status', args: '' });
    expect(parseChatCommand('  /Query a b  ')).toEqual({ name: 'query', args: 'a b' });
    expect(parseChatCommand('/中文 参数')).toBeNull();
    expect(parseChatCommand('status')).toBeNull();
    expect(parseChatCommand('/a'.repeat(40))).toBeNull();
  });
});

describe('command prompt rendering', () => {
  it('replaces known placeholders', () => {
    expect(renderCommandPrompt('用户 {user} 在 {groupName} 请求 {args}', {
      args: '天气', user: 'u1', userName: 'Pika', group: 'g1', groupName: '测试群', command: 'weather', time: '2026-11-16T00:00:00.000Z',
    })).toBe('用户 u1 在 测试群 请求 天气');
  });

  it('appends arguments when no placeholder exists', () => {
    expect(renderCommandPrompt('总结今天的消息', {
      args: '只看技术', user: 'u1', userName: 'Pika', group: 'g1', groupName: '测试群', command: 'summary', time: '',
    })).toBe('总结今天的消息\n\n用户输入：只看技术');
  });

  it('renders scheduled text placeholders', () => {
    expect(renderScheduleText('{name} at {time}', { name: '早报', time: '09:00' })).toBe('早报 at 09:00');
  });
});
