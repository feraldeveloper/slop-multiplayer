window.GAME_CONFIG = {
  apiBaseUrl: "https://slop-game-api.aeneas-c20.workers.dev",
  autoConnect: true,
  autoCreateRoom: true,
  roomId: "",
  playerName: `pilot-${Math.random().toString(36).slice(2, 6)}`,
  ...(window.GAME_CONFIG || {}),
};
