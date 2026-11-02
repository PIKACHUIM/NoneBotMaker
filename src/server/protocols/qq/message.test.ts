import { describe, expect, it } from 'vitest';
import { normalizeQQGroupMessage } from './message';
import type { QQAccountContext } from './types';

const account = { appId: 'bot', account: { id: 'account' } } as QQAccountContext;

describe('QQ message normalization', () => {
  it('normalizes C2C user_openid and media metadata without downloading media', () => {
    const message = normalizeQQGroupMessage({ t: 'C2C_MESSAGE_CREATE', id: 'event', d: {
      id: 'message', author: { user_openid: 'private-user' }, content: 'hello',
      attachments: [
        { url: '//cdn.example.com/image.png', content_type: 'image/png', filename: 'photo.png', size: 123, width: 20 },
        { url: 'http://localhost/file', content_type: 'application/pdf' },
        { url: 'data:image/png;base64,aGVsbG8=', content_type: 'image/png' },
      ],
    } }, account, 1000);
    expect(message).toMatchObject({ groupId: 'private-user', userId: 'private-user', conversationType: 'private', mentionsBot: true });
    expect(message?.attachments).toEqual([{ url: 'https://cdn.example.com/image.png', type: 'image', contentType: 'image/png', filename: 'photo.png', size: 123, width: 20 }]);
  });

  it('retains group semantics and ignores bot-authored/missing-openid events', () => {
    expect(normalizeQQGroupMessage({ t: 'C2C_MESSAGE_CREATE', d: { id: 'm', author: { bot: true, user_openid: 'user' } } }, account, 0)).toBeNull();
    expect(normalizeQQGroupMessage({ t: 'C2C_MESSAGE_CREATE', d: { id: 'm' } }, account, 0)).toBeNull();
    expect(normalizeQQGroupMessage({ t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'm', group_openid: 'group', author: { member_openid: 'member' }, content: '<@bot> hello' } }, account, 0)).toMatchObject({ conversationType: 'group', text: 'hello', mentionsBot: true });
  });
});
