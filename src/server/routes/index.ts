import { Hono } from 'hono';
import type { RuntimeBindings } from '../../shared/types';
import {
  constantTimePasswordMatches,
  createSessionToken,
  getCookie,
  isSameOrigin,
  SESSION_COOKIE,
  sessionCookie,
  verifySessionToken,
} from '../auth';
import { ApiError, registerManagementRoutes } from './management';
import { registerLogRoutes } from './logs';
import { registerProviderModelRoutes } from './provider-models';
import { registerLogCleanupRoute } from './log-cleanup';
import { registerSetupRoutes } from './setup';
import { registerChatbotRuntimeRoutes } from './chatbot-runtime';

const MANAGED_PATH = /(?:^|\/)(plugins|accounts|groups|providers|prices|skills|mcps|rules|role_cards|memories|policies|chatbot|logs)(?:\/|$)/;
const AUTH_PATH = /^\/(?:api\/)?auth(?:\/|$)/;
const QQ_WEBHOOK_PATH = /(?:^|\/)webhook\/qq\/?$/;
const LOG_CLEANUP_PATH = /(?:^|\/)internal\/logs\/purge\/?$/;

export function createApiRouter() {
  const api = new Hono<{ Bindings: RuntimeBindings }>();

  api.onError((error, context) => {
    if (error instanceof ApiError) return context.json({ error: error.code }, error.status);
    if (error instanceof SyntaxError) return context.json({ error: 'invalid_json' }, 400);
    return context.json({ error: 'internal_error' }, 500);
  });

  api.use('*', async (context, next) => {
    const method = context.req.method.toUpperCase();
    const path = context.req.path;
    const isCleanupEndpoint = LOG_CLEANUP_PATH.test(path);
    const isAdminEndpoint = AUTH_PATH.test(path) || MANAGED_PATH.test(path) || isCleanupEndpoint;
    const isQQWebhook = QQ_WEBHOOK_PATH.test(path);
    const authorization = context.req.header('Authorization');
    const cleanupToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const cleanupBearerAuthorized = isCleanupEndpoint && Boolean(context.env.SYS_SECRET) &&
      await constantTimePasswordMatches(cleanupToken, context.env.SYS_SECRET ?? '');

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && isAdminEndpoint && !isQQWebhook && !cleanupBearerAuthorized && !isSameOrigin(context.req.raw)) {
      return context.json({ error: 'origin_check_failed' }, 403);
    }

    if ((!isCleanupEndpoint && MANAGED_PATH.test(path)) || (isCleanupEndpoint && !cleanupBearerAuthorized)) {
      const authenticated = await verifySessionToken(
        context.env,
        getCookie(context.req.raw, SESSION_COOKIE),
      );
      if (!authenticated) return context.json({ error: 'unauthorized' }, 401);
      const isBlob = context.env.PLATFORM === 'edgeone' && Boolean(context.env.EDGEONE_BLOB);
      context.header('X-Storage-Consistency', isBlob ? 'provider-defined' : 'eventual');
    }

    await next();
  });

  api.get('/health', (context) => context.json({ ok: true, service: 'nonebotmaker' }));

  api.post('/auth/login', async (context) => {
    if (!context.env.SYS_PASSWD) return context.json({ error: 'login_unavailable' }, 503);
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).password !== 'string') {
      return context.json({ error: 'invalid_password' }, 400);
    }
    if (!(await constantTimePasswordMatches((body as { password: string }).password, context.env.SYS_PASSWD))) {
      return context.json({ error: 'unauthorized' }, 401);
    }
    try {
      const token = await createSessionToken(context.env);
      context.header('Set-Cookie', sessionCookie(token));
      return context.json({ data: { authenticated: true } });
    } catch {
      return context.json({ error: 'login_unavailable' }, 503);
    }
  });

  api.post('/auth/logout', (context) => {
    context.header('Set-Cookie', sessionCookie('', 0));
    return context.json({ data: { authenticated: false } });
  });

  api.get('/auth/me', async (context) => {
    const authenticated = await verifySessionToken(context.env, getCookie(context.req.raw, SESSION_COOKIE));
    if (!authenticated) return context.json({ error: 'unauthorized' }, 401);
    return context.json({ data: { authenticated: true } });
  });

  registerSetupRoutes(api);
  registerLogRoutes(api);
  registerLogCleanupRoute(api);
  registerProviderModelRoutes(api);
  registerChatbotRuntimeRoutes(api);
  registerManagementRoutes(api);
  return api;
}
