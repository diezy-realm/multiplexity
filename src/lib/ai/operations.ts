const state = globalThis as typeof globalThis & { managerChatOperations?: Map<string, AbortController> };
export const chatOperations = state.managerChatOperations ??= new Map<string, AbortController>();
