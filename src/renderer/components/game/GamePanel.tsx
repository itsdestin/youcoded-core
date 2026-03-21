import React from 'react';
import { useGameState, useGameDispatch } from '../../state/game-context';
import { useGameConnection } from '../../hooks/useGameConnection';
import GameLobby from './GameLobby';
import ConnectFourBoard from './ConnectFourBoard';
import GameChat from './GameChat';
import GameOverlay from './GameOverlay';

export default function GamePanel() {
  const state = useGameState();
  const dispatch = useGameDispatch();
  const connection = useGameConnection();
  const isPlaying = state.screen === 'playing' || state.screen === 'game-over';

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-full shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-sm font-semibold text-gray-200">Connect 4</span>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_PANEL' })}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {isPlaying ? (
          <div className="relative flex flex-col flex-1">
            <ConnectFourBoard connection={connection} />
            <GameChat connection={connection} />
            {state.screen === 'game-over' && (
              <GameOverlay connection={connection} />
            )}
          </div>
        ) : (
          <GameLobby connection={connection} />
        )}
      </div>
    </div>
  );
}
