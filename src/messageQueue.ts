export interface QueuedMessage { id: string; prompt: string; yolo: boolean; remote: boolean }
export interface MessageQueue { items: QueuedMessage[]; paused: boolean; reason: string | null }
export type QueueRequest = { action: 'pause' | 'resume' | 'clear' } | { action: 'remove'; message_id: string } | { action: 'edit'; message_id: string; prompt: string };
export const emptyQueue = (): MessageQueue => ({ items: [], paused: false, reason: null });
