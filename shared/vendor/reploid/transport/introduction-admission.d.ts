import type { PeerContact } from './introductions.js';
export function createRoomIntroductionAdmission(options: { roomId: string; token: string }): {
  create(body: Omit<PeerContact['body'], 'admission'>): Promise<{ schema: 'reploid.room-admission/v1'; proof: string }>;
  verify(record: PeerContact): Promise<boolean>;
};
