-- Additive defaults for existing deployments: local helper tools, video generation,
-- and official per-image / per-second media prices. Fresh installations receive the
-- same records through initializeD1Setup; all statements are idempotent.

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-generate-video',
  json_object(
    'id', 'builtin-chat-generate-video',
    'createdAt', '2026-11-16T00:00:00.000Z',
    'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '视频生成',
    'description', '经授权后调用已配置的视频接口，按每秒单价计费。',
    'enabled', json('false'),
    'config', json_object(
      'kind', 'builtin', 'name', 'chat_generate_video', 'providerId', '', 'model', '',
      'protocol', 'minimax', 'resolution', '768P', 'duration', 6, 'fallbackCostPerSecond', 0
    )
  ),
  '2026-11-16T00:00:00.000Z';

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-calculate',
  json_object('id', 'builtin-chat-calculate', 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '计算器', 'description', '内置工具；实际调用须经身份策略授权。', 'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_calculate')),
  '2026-11-16T00:00:00.000Z';

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-random',
  json_object('id', 'builtin-chat-random', 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '随机数', 'description', '内置工具；实际调用须经身份策略授权。', 'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_random')),
  '2026-11-16T00:00:00.000Z';

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-uuid',
  json_object('id', 'builtin-chat-uuid', 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', 'UUID 生成', 'description', '内置工具；实际调用须经身份策略授权。', 'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_uuid')),
  '2026-11-16T00:00:00.000Z';

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-base64',
  json_object('id', 'builtin-chat-base64', 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', 'Base64 编解码', 'description', '内置工具；实际调用须经身份策略授权。', 'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_base64')),
  '2026-11-16T00:00:00.000Z';

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-hash',
  json_object('id', 'builtin-chat-hash', 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '文本哈希', 'description', '内置工具；实际调用须经身份策略授权。', 'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_hash')),
  '2026-11-16T00:00:00.000Z';

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'tools', 'builtin-chat-text-stats',
  json_object('id', 'builtin-chat-text-stats', 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'name', '文本统计', 'description', '内置工具；实际调用须经身份策略授权。', 'enabled', json('true'),
    'config', json_object('kind', 'builtin', 'name', 'chat_text_stats')),
  '2026-11-16T00:00:00.000Z';

-- OpenAI gpt-image-2 already exists in older installs; add the official 1K tier price
-- without overwriting an operator's configured value.
UPDATE records
SET value = json_set(value, '$.imageCostPer1K', 0.053)
WHERE kind = 'prices' AND id = 'openai-gpt-image-2'
  AND json_extract(value, '$.imageCostPer1K') IS NULL;

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'prices', 'minimax-image-01',
  json_object('id', 'minimax-image-01', 'name', 'MiniMax image-01', 'model', 'image-01',
    'inputCostPerMillion', 0, 'outputCostPerMillion', 0,
    'imageCostPer1K', 0.0035, 'imageCostPer2K', 0.0035, 'imageCostPer4K', 0.0035,
    'currency', 'USD', 'unit', 'tokens', 'sourceUrl', 'https://platform.minimax.io/docs/pricing/overview',
    'enabled', json('true'), 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z'),
  '2026-11-16T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM records WHERE kind = 'prices' AND json_extract(value, '$.model') = 'image-01');

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'prices', 'minimax-h3',
  json_object('id', 'minimax-h3', 'name', 'MiniMax H3', 'model', 'MiniMax-H3',
    'inputCostPerMillion', 0, 'outputCostPerMillion', 0,
    'videoCostPerSecond', 0.08, 'videoCostPerSecondHd', 0.13,
    'currency', 'USD', 'unit', 'tokens', 'sourceUrl', 'https://platform.minimax.io/docs/pricing/overview',
    'enabled', json('true'), 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z'),
  '2026-11-16T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM records WHERE kind = 'prices' AND json_extract(value, '$.model') = 'MiniMax-H3');

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'prices', 'minimax-hailuo-2.3',
  json_object('id', 'minimax-hailuo-2.3', 'name', 'MiniMax Hailuo 2.3', 'model', 'MiniMax-Hailuo-2.3',
    'inputCostPerMillion', 0, 'outputCostPerMillion', 0,
    'videoCostPerSecond', 0.046667, 'videoCostPerSecondHd', 0.081667,
    'currency', 'USD', 'unit', 'tokens', 'sourceUrl', 'https://platform.minimax.io/docs/pricing/overview',
    'enabled', json('true'), 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z'),
  '2026-11-16T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM records WHERE kind = 'prices' AND json_extract(value, '$.model') = 'MiniMax-Hailuo-2.3');

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'prices', 'minimax-hailuo-2.3-fast',
  json_object('id', 'minimax-hailuo-2.3-fast', 'name', 'MiniMax Hailuo 2.3 Fast', 'model', 'MiniMax-Hailuo-2.3-Fast',
    'inputCostPerMillion', 0, 'outputCostPerMillion', 0,
    'videoCostPerSecond', 0.031667, 'videoCostPerSecondHd', 0.055,
    'currency', 'USD', 'unit', 'tokens', 'sourceUrl', 'https://platform.minimax.io/docs/pricing/overview',
    'enabled', json('true'), 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z'),
  '2026-11-16T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM records WHERE kind = 'prices' AND json_extract(value, '$.model') = 'MiniMax-Hailuo-2.3-Fast');

INSERT OR IGNORE INTO records (kind, id, value, updated_at)
SELECT 'prices', 'minimax-hailuo-02',
  json_object('id', 'minimax-hailuo-02', 'name', 'MiniMax Hailuo 02', 'model', 'MiniMax-Hailuo-02',
    'inputCostPerMillion', 0, 'outputCostPerMillion', 0,
    'videoCostPerSecond', 0.046667, 'videoCostPerSecondHd', 0.081667,
    'currency', 'USD', 'unit', 'tokens', 'sourceUrl', 'https://platform.minimax.io/docs/pricing/overview',
    'enabled', json('true'), 'createdAt', '2026-11-16T00:00:00.000Z', 'updatedAt', '2026-11-16T00:00:00.000Z'),
  '2026-11-16T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM records WHERE kind = 'prices' AND json_extract(value, '$.model') = 'MiniMax-Hailuo-02');
