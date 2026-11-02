import { Hono } from 'hono';
import type { RuntimeBindings } from '../shared/types';
import { replyToQQGroup } from './protocols/qq/api';
import { resolveQQAccountByAppId } from './protocols/qq/accounts';
import { createQQWebhookRouter } from './protocols/qq/webhook';
import { createPersistentChatbotStores, createStoredChatbotHandler } from './plugins/chatbot/runtime';
import { createApiRouter } from './routes';

export function createApp() {
  const app = new Hono<{ Bindings: RuntimeBindings }>();
  app.use('*', async (context, next) => {
    const bindings = context.env ?? {};
    const method = bindings.API_METHOD ?? 'webhook';
    if (method !== 'webhook' && method !== 'websocket') {
      return context.json({ error: 'invalid_api_method' }, 503);
    }
    if (method === 'websocket' && bindings.PLATFORM !== 'cloudflare') {
      return context.json({ error: 'websocket_unsupported' }, 503);
    }
    await next();
  });
  app.route('/api', createApiRouter());
  app.route('/', createQQWebhookRouter({
    resolveAccount: resolveQQAccountByAppId,
    handleMessage: async (account, message, bindings) => {
      const handler = createStoredChatbotHandler(bindings, {
        ...createPersistentChatbotStores(bindings),
        sendReply: replyToQQGroup,
      });
      await handler(account, message);
    },
  }));
  return app;
}

export const app = createApp();
