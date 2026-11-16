-- Backfill the complete built-in tool catalog for deployments created before
-- newer built-ins (notably WebSearch/WebFetch) were added to the default seed.
-- Personas and per-identity grants remain operator data and are never seeded here.
-- One statement per tool keeps D1's compound-SELECT limit out of the picture.

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-WebSearch',
  json_object(
    'id', 'builtin-WebSearch',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '联网搜索',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'WebSearch')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-WebFetch',
  json_object(
    'id', 'builtin-WebFetch',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '网页读取',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'WebFetch')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_status',
  json_object(
    'id', 'builtin-chat_status',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '会话状态',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_status')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_time',
  json_object(
    'id', 'builtin-chat_time',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '当前时间',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_time')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_current_datetime',
  json_object(
    'id', 'builtin-chat_current_datetime',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '当前日期时间',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_current_datetime')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_timezone_info',
  json_object(
    'id', 'builtin-chat_timezone_info',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '时区信息',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_timezone_info')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_history',
  json_object(
    'id', 'builtin-chat_history',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '会话历史',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_history')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_send',
  json_object(
    'id', 'builtin-chat_send',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '发送消息',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_send')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_wait',
  json_object(
    'id', 'builtin-chat_wait',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '等待消息',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_wait')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-MemoryRead',
  json_object(
    'id', 'builtin-MemoryRead',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '读取记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'MemoryRead')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-MemorySearch',
  json_object(
    'id', 'builtin-MemorySearch',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '搜索记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'MemorySearch')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-MemoryWrite',
  json_object(
    'id', 'builtin-MemoryWrite',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '写入记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'MemoryWrite')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-MemoryForget',
  json_object(
    'id', 'builtin-MemoryForget',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '删除记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'MemoryForget')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-ProjectMemorySearch',
  json_object(
    'id', 'builtin-ProjectMemorySearch',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '搜索项目记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'ProjectMemorySearch')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-ProjectMemoryRead',
  json_object(
    'id', 'builtin-ProjectMemoryRead',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '读取项目记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'ProjectMemoryRead')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-ProjectMemoryWrite',
  json_object(
    'id', 'builtin-ProjectMemoryWrite',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '写入项目记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'ProjectMemoryWrite')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-ProjectMemoryForget',
  json_object(
    'id', 'builtin-ProjectMemoryForget',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '删除项目记忆',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'ProjectMemoryForget')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_save_meme',
  json_object(
    'id', 'builtin-chat_save_meme',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '保存表情',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_save_meme')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_list_memes',
  json_object(
    'id', 'builtin-chat_list_memes',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '列出表情',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_list_memes')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_send_meme',
  json_object(
    'id', 'builtin-chat_send_meme',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '发送表情',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_send_meme')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_delete_meme',
  json_object(
    'id', 'builtin-chat_delete_meme',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '删除表情',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_delete_meme')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_list_voices',
  json_object(
    'id', 'builtin-chat_list_voices',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '列出语音',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_list_voices')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_send_voice',
  json_object(
    'id', 'builtin-chat_send_voice',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '发送语音',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_send_voice')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_save_voice',
  json_object(
    'id', 'builtin-chat_save_voice',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '保存语音',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_save_voice')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_delete_voice',
  json_object(
    'id', 'builtin-chat_delete_voice',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '删除语音',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_delete_voice')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_send_media',
  json_object(
    'id', 'builtin-chat_send_media',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '发送媒体',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_send_media')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_tts',
  json_object(
    'id', 'builtin-chat_tts',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '语音合成',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_tts')
  ),
  '2026-11-16T00:00:00.000Z'
);

INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (
  'tools', 'builtin-chat_wake',
  json_object(
    'id', 'builtin-chat_wake',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '计划唤醒',
    'description', '内置工具；实际调用须经身份策略授权。',
    'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_wake')
  ),
  '2026-11-16T00:00:00.000Z'
);
