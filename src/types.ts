export type GameStatus = 'lobby' | 'reveal' | 'clue' | 'discussion' | 'voting' | 'results';
export type GameMode = 'online' | 'offline';

export interface Player {
  id: string;
  name: string;
  word?: string;
  isImposter: boolean;
  isReady: boolean;
  clue?: string;
  vote?: string;
  score: number;
  color: string;
}

export interface GameState {
  status: GameStatus;
  players: Record<string, Player>;
  wordA?: string;
  wordB?: string;
  currentCluePlayerId?: string;
  timer: number;
  winner?: 'players' | 'imposter';
  roomCode: string;
}

export type ServerMessage =
  | { type: 'init'; state: GameState; playerId: string }
  | { type: 'update'; state: GameState }
  | { type: 'voice'; from: string; data: string }
  | { type: 'chat'; from: string; name: string; text: string }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'create_room'; name: string }
  | { type: 'join_room'; name: string; roomCode: string }
  | { type: 'ready' }
  | { type: 'submit_clue'; clue: string }
  | { type: 'vote'; targetId: string }
  | { type: 'voice'; data: string }
  | { type: 'chat'; text: string }
  | { type: 'start_game' };
