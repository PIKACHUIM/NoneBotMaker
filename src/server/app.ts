import { Hono } from 'hono';
import type { RuntimeBindings } from '../shared/types';
import { resolveQQAccountByAppId } from './protocols/qq/accounts';
import { createQQWebhookRouter } from './protocols/qq/webhook';
import { createFeishuWebhookRouter } from './protocols/feishu/webhook';
import { createDingTalkWebhookRouter } from './protocols/dingtalk/webhook';
import { createWeChatWebhookRouter } from './protocols/wechat/webhook';
import { createOneBotWebhookRouter } from './protocols/onebot/webhook';
import { createTelegramWebhookRouter } from './protocols/telegram/webhook';
import { createSlackWebhookRouter } from './protocols/slack/webhook';
import { createLineWebhookRouter } from './protocols/line/webhook';
import { createWhatsAppWebhookRouter } from './protocols/whatsapp/webhook';
import { createMattermostWebhookRouter } from './protocols/mattermost/webhook';
import { createWeComWebhookRouter } from './protocols/wecom/webhook';
import { createMessengerWebhookRouter } from './protocols/messenger/webhook';
import { createVkWebhookRouter } from './protocols/vk/webhook';
import { createZulipWebhookRouter } from './protocols/zulip/webhook';
import { createRocketChatWebhookRouter } from './protocols/rocketchat/webhook';
import { createInstagramWebhookRouter } from './protocols/instagram/webhook';
import { createViberWebhookRouter } from './protocols/viber/webhook';
import type { ChatAccountContext, ChatPlatformMessage } from './protocols/types';
import { sendChatMedia, sendChatText } from './protocols/sender';
import { createPersistentChatbotStores, createStoredChatbotHandler } from './plugins/chatbot/runtime';
import { createApiRouter } from './routes';

function handleInboundMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void> {
  const handler = createStoredChatbotHandler(bindings, {
    ...createPersistentChatbotStores(bindings),
    sendReply: sendChatText,
    sendMedia: sendChatMedia,
  });
  return handler(account, message);
}

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
    handleMessage: handleInboundMessage,
  }));
  app.route('/', createFeishuWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createDingTalkWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createWeChatWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createOneBotWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createTelegramWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createSlackWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createLineWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createWhatsAppWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createMattermostWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createWeComWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createMessengerWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createVkWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createZulipWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createRocketChatWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createInstagramWebhookRouter({ handleMessage: handleInboundMessage }));
  app.route('/', createViberWebhookRouter({ handleMessage: handleInboundMessage }));
  return app;
}

export const app = createApp();
