import { serve } from '@hono/node-server';
import { app } from './app';
import type { RuntimeBindings } from '../shared/types';

const bindings: RuntimeBindings = {
  SYS_PASSWD: process.env.SYS_PASSWD,
  DB_SECRET: process.env.DB_SECRET,
  SETUP_TOKEN: process.env.SETUP_TOKEN,
  LOG_RECORD: process.env.LOG_RECORD ?? 'false',
  API_METHOD: process.env.API_METHOD ?? 'webhook',
  PLATFORM: 'local',
};

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
serve({ fetch: (request) => app.fetch(request, bindings), port }, (info) => {
  console.log(`Hono API listening on http://127.0.0.1:${info.port}`);
});
