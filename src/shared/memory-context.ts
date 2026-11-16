/** Selectable automatic-memory context windows, expressed in model tokens. */
export const MEMORY_CONTEXT_OPTIONS = [
  { value: '32K', tokens: 32_768 },
  { value: '64K', tokens: 65_536 },
  { value: '128K', tokens: 131_072 },
  { value: '256K', tokens: 262_144 },
  { value: '512K', tokens: 524_288 },
  { value: '1M', tokens: 1_048_576 },
] as const;

export type MemoryContextLength = typeof MEMORY_CONTEXT_OPTIONS[number]['value'];
export const DEFAULT_MEMORY_CONTEXT_LENGTH: MemoryContextLength = '32K';

export function memoryContextTokens(value: unknown): number {
  const option = MEMORY_CONTEXT_OPTIONS.find((item) => item.value === value);
  return option?.tokens ?? MEMORY_CONTEXT_OPTIONS[0].tokens;
}

export function memoryContextLength(value: unknown): MemoryContextLength {
  const option = MEMORY_CONTEXT_OPTIONS.find((item) => item.value === value);
  return option?.value ?? DEFAULT_MEMORY_CONTEXT_LENGTH;
}
