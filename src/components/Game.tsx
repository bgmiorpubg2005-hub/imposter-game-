import React, { useState, useEffect, useRef } from 'react';
import { GameState, Player, ServerMessage, ClientMessage, GameStatus, GameMode } from '../types';
import { VoiceChat } from './VoiceChat';
import { motion, AnimatePresence } from 'motion/react';
import { User, MessageSquare, Timer, Trophy, AlertCircle, Send, Mic, MicOff, Users, Crown, Sparkles, Loader2, Plus, Minus, Settings, CheckCircle2, XCircle, Copy, Check, LogIn, LogOut } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { useFirebase } from './FirebaseProvider';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, increment, addDoc, collection, serverTimestamp } from 'firebase/firestore';

export default function Game() {
  const { user, signIn, logout, isAuthReady } = useFirebase();
  const [mode, setMode] = useState<GameMode | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [clue, setClue] = useState('');
  const [chatText, setChatText] = useState('');
  const [chatMessages, setChatMessages] = useState<{ name: string; text: string; color: string }[]>([]);
  const [incomingAudio, setIncomingAudio] = useState<{ from: string; data: string } | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [isGeneratingHint, setIsGeneratingHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlineAction, setOnlineAction] = useState<'create' | 'join' | null>(null);
  const [copied, setCopied] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  // Offline State
  const [offlineSetup, setOfflineSetup] = useState({
    playerCount: 3,
    imposterCount: 1,
    imposterHasWord: true,
    manualImposter: false,
    selectedImposterIds: [] as string[],
    names: [] as string[],
    discussionTime: 60, // Default 60 seconds
  });
  const [offlineGameState, setOfflineGameState] = useState<GameState | null>(null);
  const [offlineRevealIndex, setOfflineRevealIndex] = useState(0);
  const [isCardRevealed, setIsCardRevealed] = useState(false);
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null);
  const [checkedOfflinePlayerIds, setCheckedOfflinePlayerIds] = useState<string[]>([]);

  // Offline Timer Effect
  useEffect(() => {
    if (mode === 'offline' && offlineGameState?.status === 'discussion' && offlineGameState.timer > 0) {
      const interval = setInterval(() => {
        setOfflineGameState(prev => {
          if (prev && prev.status === 'discussion' && prev.timer > 0) {
            const newTimer = prev.timer - 1;
            if (newTimer === 0) {
              return { ...prev, timer: 0, status: 'voting' };
            }
            return { ...prev, timer: newTimer };
          }
          return prev;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [mode, offlineGameState?.status, offlineGameState?.timer]);

  useEffect(() => {
    if (user?.displayName && !name) {
      setName(user.displayName);
    }
  }, [user, name]);

  // Record game results to Firestore
  useEffect(() => {
    if (gameState?.status === 'results' && user) {
      const recordGame = async () => {
        try {
          const gameRef = collection(db, 'games');
          await addDoc(gameRef, {
            roomCode: gameState.roomCode,
            winner: gameState.winner,
            players: Object.values(gameState.players).map(p => p.name),
            wordA: gameState.wordA,
            wordB: gameState.wordB,
            timestamp: serverTimestamp()
          });

          // Update user stats
          const userRef = doc(db, 'users', user.uid);
          const me = gameState.players[playerId || ''];
          const won = (me?.isImposter && gameState.winner === 'imposter') || 
                      (!me?.isImposter && gameState.winner === 'players');
          
          await updateDoc(userRef, {
            totalScore: increment(me?.score || 0),
            gamesPlayed: increment(1),
            gamesWon: increment(won ? 1 : 0)
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'games/users');
        }
      };
      
      // Only one player records the game to avoid duplicates (e.g., the one with the smallest ID)
      const sortedIds = Object.keys(gameState.players).sort();
      if (playerId === sortedIds[0]) {
        recordGame();
      }
    }
  }, [gameState?.status, user, playerId, gameState]);

  useEffect(() => {
    if (mode !== 'online') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws.current = new WebSocket(`${protocol}//${window.location.host}`);

    ws.current.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);
        if (message.type === 'init') {
          setGameState(message.state);
          setPlayerId(message.playerId);
          setIsJoined(true);
          setError(null);
        } else if (message.type === 'update') {
          setGameState(message.state);
        } else if (message.type === 'voice') {
          setIncomingAudio({ from: message.from, data: message.data });
        } else if (message.type === 'chat') {
          const sender = gameState?.players[message.from];
          setChatMessages(prev => [...prev, { 
            name: message.name, 
            text: message.text, 
            color: sender?.color || '#fff' 
          }].slice(-50));
        } else if (message.type === 'error') {
          setError(message.message);
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    return () => ws.current?.close();
  }, [mode, gameState?.players]);

  useEffect(() => {
    if (gameState?.status === 'lobby' || gameState?.status === 'reveal') {
      setHintText(null);
    }
  }, [gameState?.status]);

  const send = (message: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not open. State:', ws.current?.readyState);
    }
  };

  const handleCopyCode = () => {
    if (currentGameState?.roomCode) {
      navigator.clipboard.writeText(currentGameState.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreateRoom = () => {
    if (name.trim()) {
      send({ type: 'create_room', name });
    }
  };

  const handleJoinRoom = () => {
    if (name.trim() && roomCodeInput.trim()) {
      send({ type: 'join_room', name, roomCode: roomCodeInput });
    }
  };

  const handleExitLobby = () => {
    ws.current?.close();
    setMode(null);
    setGameState(null);
    setIsJoined(false);
    setPlayerId(null);
    setOnlineAction(null);
    setError(null);
    setChatMessages([]);
  };

  const handleOfflineStart = () => {
    if (offlineSetup.playerCount < 3) {
      setError("At least 3 players are required.");
      return;
    }
    if (offlineSetup.imposterCount >= offlineSetup.playerCount) {
      setError("Too many imposters.");
      return;
    }

    const WORD_PAIRS = [
      { a: "Pizza", b: "Burger" },
      { a: "Laptop", b: "Tablet" },
      { a: "Football", b: "Basketball" },
      { a: "Coffee", b: "Tea" },
      { a: "Bicycle", b: "Motorcycle" },
      { a: "Airplane", b: "Helicopter" },
      { a: "Cat", b: "Lion" },
      { a: "Ocean", b: "Lake" },
      { a: "Sun", b: "Moon" },
      { a: "Doctor", b: "Nurse" },
    ];
    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
    const players: Record<string, Player> = {};
    const imposterIndices = new Set<number>();
    while (imposterIndices.size < offlineSetup.imposterCount) {
      imposterIndices.add(Math.floor(Math.random() * offlineSetup.playerCount));
    }

    for (let i = 0; i < offlineSetup.playerCount; i++) {
      const n = offlineSetup.names[i];
      const id = `offline-${i}`;
      const isImposter = imposterIndices.has(i);
      
      players[id] = {
        id,
        name: n || `Player ${i + 1}`,
        isImposter,
        isReady: true,
        score: 0,
        color: `hsl(${(i * 360) / offlineSetup.playerCount}, 70%, 60%)`,
        word: isImposter ? (offlineSetup.imposterHasWord ? pair.b : '???') : pair.a,
      };
    }

    setOfflineGameState({
      status: 'reveal',
      players,
      timer: offlineSetup.discussionTime,
      roomCode: 'OFFLINE',
      wordA: pair.a,
      wordB: pair.b,
    });
    setOfflineRevealIndex(0);
    setIsCardRevealed(false);
    setCheckedOfflinePlayerIds([]);
  };

  const handleRequestHint = async () => {
    if (!me?.word || isGeneratingHint) return;
    
    setIsGeneratingHint(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Give me a very subtle, one-sentence hint for the word "${me.word}" in a social deduction game. The hint should be clever and not too obvious.`,
      });
      setHintText(response.text || "Could not generate a hint.");
    } catch (err) {
      console.error("Hint generation failed:", err);
      setHintText("Failed to get a hint. Try again!");
    } finally {
      setIsGeneratingHint(false);
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatText.trim()) {
      if (mode === 'online') {
        send({ type: 'chat', text: chatText });
      } else {
        setChatMessages(prev => [...prev, { 
          name: me?.name || 'Me', 
          text: chatText, 
          color: me?.color || '#fff' 
        }].slice(-50));
      }
      setChatText('');
    }
  };

  if (!mode) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-indigo-950 text-white font-sans p-4">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="p-8 bg-white/10 backdrop-blur-xl rounded-[2rem] border border-white/20 shadow-2xl w-full max-w-md text-center"
        >
          <div className="w-20 h-20 bg-indigo-500 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-indigo-500/50">
            <MessageSquare size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-black mb-2 tracking-tighter">HIDDEN WORD</h1>
          <p className="text-indigo-200 mb-8 text-sm font-medium">Choose your game mode</p>
          
          <div className="space-y-4">
            {user ? (
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10 mb-4">
                <div className="flex items-center gap-3">
                  <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border border-white/20" referrerPolicy="no-referrer" />
                  <div className="text-left">
                    <div className="text-xs text-indigo-300 font-bold uppercase">Logged in as</div>
                    <div className="font-black text-sm">{user.displayName}</div>
                  </div>
                </div>
                <button onClick={logout} className="p-2 hover:bg-white/10 rounded-xl transition-all text-indigo-300">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button
                onClick={signIn}
                className="w-full p-4 bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-3 mb-4"
              >
                <LogIn size={18} />
                SIGN IN WITH GOOGLE
              </button>
            )}

            <button
              onClick={() => setMode('online')}
              className="w-full p-6 bg-indigo-500 hover:bg-indigo-400 rounded-2xl font-black text-xl transition-all shadow-xl shadow-indigo-500/30 flex items-center justify-center gap-3"
            >
              <Users size={24} />
              ONLINE MODE
            </button>
            <button
              onClick={() => setMode('offline')}
              className="w-full p-6 bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl font-black text-xl transition-all flex items-center justify-center gap-3"
            >
              <User size={24} />
              OFFLINE MODE
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (mode === 'offline' && !offlineGameState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-indigo-950 text-white font-sans p-4 overflow-y-auto py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 bg-white/10 backdrop-blur-xl rounded-[2.5rem] border border-white/20 shadow-2xl w-full max-w-2xl"
        >
          <div className="flex items-center justify-center gap-3 mb-8">
            <Settings className="text-indigo-400" size={32} />
            <h2 className="text-4xl font-black tracking-tighter text-center">GAME SETUP</h2>
          </div>
          
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Player Count Control */}
              <div className="bg-black/20 p-6 rounded-3xl border border-white/5">
                <label className="text-xs font-black uppercase text-indigo-300 mb-4 block tracking-widest">Player Count</label>
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => setOfflineSetup(prev => {
                      const count = Math.max(3, prev.playerCount - 1);
                      return {
                        ...prev,
                        playerCount: count,
                        names: Array(count).fill('').map((_, i) => prev.names[i] || '')
                      };
                    })}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/10"
                  >
                    <Minus size={20} />
                  </button>
                  <span className="text-4xl font-black">{offlineSetup.playerCount}</span>
                  <button 
                    onClick={() => setOfflineSetup(prev => {
                      const count = Math.min(12, prev.playerCount + 1);
                      return {
                        ...prev,
                        playerCount: count,
                        names: Array(count).fill('').map((_, i) => prev.names[i] || '')
                      };
                    })}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/10"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>

              {/* Imposter Count Control */}
              <div className="bg-black/20 p-6 rounded-3xl border border-white/5">
                <label className="text-xs font-black uppercase text-indigo-300 mb-4 block tracking-widest">Imposters</label>
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => setOfflineSetup(prev => ({ ...prev, imposterCount: Math.max(1, prev.imposterCount - 1) }))}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/10"
                  >
                    <Minus size={20} />
                  </button>
                  <span className="text-4xl font-black">{offlineSetup.imposterCount}</span>
                  <button 
                    onClick={() => setOfflineSetup(prev => ({ ...prev, imposterCount: Math.min(Math.floor(prev.playerCount / 2), prev.imposterCount + 1) }))}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/10"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>

              {/* Discussion Time Control */}
              <div className="bg-black/20 p-6 rounded-3xl border border-white/5">
                <label className="text-xs font-black uppercase text-indigo-300 mb-4 block tracking-widest">Discussion Time</label>
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => setOfflineSetup(prev => ({ ...prev, discussionTime: Math.max(30, prev.discussionTime - 30) }))}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/10"
                  >
                    <Minus size={20} />
                  </button>
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-black">{offlineSetup.discussionTime}</span>
                    <span className="text-[10px] font-bold text-indigo-400">SECONDS</span>
                  </div>
                  <button 
                    onClick={() => setOfflineSetup(prev => ({ ...prev, discussionTime: Math.min(600, prev.discussionTime + 30) }))}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/10"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>

              {/* Imposter Word Toggle */}
              <div className="bg-black/20 p-6 rounded-3xl border border-white/5 flex flex-col justify-between">
                <label className="text-xs font-black uppercase text-indigo-300 mb-4 block tracking-widest">Imposter Word</label>
                <button 
                  onClick={() => setOfflineSetup(prev => ({ ...prev, imposterHasWord: !prev.imposterHasWord }))}
                  className={`w-full p-3 rounded-2xl font-black transition-all border ${
                    offlineSetup.imposterHasWord 
                      ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' 
                      : 'bg-white/5 border-white/10 text-white/40'
                  }`}
                >
                  {offlineSetup.imposterHasWord ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-black uppercase text-indigo-300 block tracking-widest">Player Names</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                {Array.from({ length: offlineSetup.playerCount }).map((_, i) => (
                  <div key={i} className="relative">
                    <input
                      type="text"
                      placeholder={`Player ${i + 1}`}
                      value={offlineSetup.names[i] || ''}
                      onChange={(e) => {
                        const newNames = [...offlineSetup.names];
                        newNames[i] = e.target.value;
                        setOfflineSetup(prev => ({ ...prev, names: newNames }));
                      }}
                      className="w-full p-4 bg-black/40 border border-white/10 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all pl-12"
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500/50 font-black text-xs">
                      {i + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                onClick={() => setMode(null)}
                className="flex-1 p-5 bg-white/5 hover:bg-white/10 rounded-2xl font-black transition-all border border-white/10"
              >
                BACK
              </button>
              <button
                onClick={handleOfflineStart}
                className="flex-[2] p-5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-black text-xl transition-all shadow-xl shadow-indigo-500/30"
              >
                START GAME
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (mode === 'online' && !isJoined) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-indigo-950 text-white font-sans p-4">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="p-8 bg-white/10 backdrop-blur-xl rounded-[2rem] border border-white/20 shadow-2xl w-full max-w-md text-center"
        >
          <h1 className="text-4xl font-black mb-2 tracking-tighter">ONLINE MODE</h1>
          <p className="text-indigo-200 mb-8 text-sm font-medium">Choose an option to start</p>
          
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Your Nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-4 bg-black/20 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all text-center font-bold"
            />
            
            <div className="h-px bg-white/10 my-4" />
            
            {!onlineAction ? (
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setOnlineAction('create')}
                  className="p-6 bg-indigo-500 hover:bg-indigo-400 rounded-2xl font-black text-lg transition-all shadow-xl shadow-indigo-500/30 flex flex-col items-center gap-2"
                >
                  <Plus size={24} />
                  <span>CREATE</span>
                </button>
                <button
                  onClick={() => setOnlineAction('join')}
                  className="p-6 bg-white text-indigo-950 hover:bg-indigo-50 rounded-2xl font-black text-lg transition-all flex flex-col items-center gap-2"
                >
                  <Users size={24} />
                  <span>JOIN</span>
                </button>
              </div>
            ) : onlineAction === 'create' ? (
              <div className="space-y-4">
                <button
                  onClick={handleCreateRoom}
                  disabled={!name.trim()}
                  className="w-full p-4 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl font-black text-lg transition-all shadow-xl shadow-indigo-500/30"
                >
                  CONFIRM CREATE
                </button>
                <button
                  onClick={() => setOnlineAction(null)}
                  className="w-full p-2 text-indigo-300 hover:text-white transition-all text-xs font-bold"
                >
                  BACK
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <input
                    type="text"
                    placeholder="6-Digit Code"
                    value={roomCodeInput}
                    maxLength={6}
                    onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 p-4 bg-black/20 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all text-center font-bold tracking-[0.5em]"
                  />
                  <button
                    onClick={handleJoinRoom}
                    disabled={!name.trim() || roomCodeInput.length !== 6}
                    className="p-4 bg-white text-indigo-950 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl font-black transition-all"
                  >
                    JOIN
                  </button>
                </div>
                <button
                  onClick={() => setOnlineAction(null)}
                  className="w-full p-2 text-indigo-300 hover:text-white transition-all text-xs font-bold"
                >
                  BACK
                </button>
              </div>
            )}
            
            {error && <p className="text-red-400 text-xs font-bold mt-2">{error}</p>}
            
            <button
              onClick={() => setMode(null)}
              className="w-full p-2 text-indigo-300 hover:text-white transition-all text-xs font-bold mt-4"
            >
              EXIT ONLINE MODE
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const currentGameState = mode === 'offline' ? offlineGameState : gameState;
  const me = playerId ? currentGameState?.players[playerId] : (mode === 'offline' ? Object.values(currentGameState?.players || {})[offlineRevealIndex] : null);
  const players = Object.values(currentGameState?.players || {});

  if (mode === 'offline' && currentGameState?.status === 'reveal') {
    const currentPlayer = Object.values(currentGameState.players)[offlineRevealIndex];
    return (
      <div className="h-screen w-screen bg-indigo-950 flex flex-col items-center justify-center p-4 overflow-hidden">
        <div className="text-center mb-12">
          <div className="text-indigo-300 font-black uppercase tracking-[0.3em] mb-2">Passing to</div>
          <h2 className="text-5xl font-black text-white italic">{currentPlayer.name}</h2>
        </div>

        <div className="relative w-full max-w-sm aspect-[3/4]">
          <AnimatePresence mode="wait">
            {!isCardRevealed ? (
              <motion.div
                key="hidden"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                className="w-full h-full bg-indigo-500 rounded-[3rem] shadow-2xl flex flex-col items-center justify-center p-8 border-4 border-white/20 cursor-pointer"
                onClick={() => setIsCardRevealed(true)}
              >
                <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mb-6">
                  <Sparkles size={48} className="text-white" />
                </div>
                <p className="text-white font-black text-2xl text-center leading-tight">SWIPE UP OR CLICK TO REVEAL WORD</p>
                <motion.div 
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="mt-8"
                >
                  <Crown size={32} className="text-white/50" />
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key="revealed"
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="w-full h-full bg-white rounded-[3rem] shadow-2xl flex flex-col items-center justify-center p-8 border-4 border-indigo-500/20"
              >
                <div className="text-indigo-500 font-black uppercase tracking-widest mb-4">Your Word</div>
                <div className="text-6xl font-black text-indigo-950 mb-8 text-center break-words">{currentPlayer.word}</div>
                <button
                  onClick={() => {
                    if (offlineRevealIndex < players.length - 1) {
                      setOfflineRevealIndex(prev => prev + 1);
                      setIsCardRevealed(false);
                    } else {
                      setOfflineGameState(prev => prev ? { ...prev, status: 'discussion' } : null);
                    }
                  }}
                  className="w-full p-5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-black text-xl transition-all shadow-xl"
                >
                  {offlineRevealIndex < players.length - 1 ? 'NEXT PLAYER' : 'START DISCUSSION'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-indigo-950 overflow-hidden flex flex-col font-sans text-white">
      {/* Header */}
      <div className="p-4 bg-white/5 backdrop-blur-md border-b border-white/10 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold shadow-inner" style={{ backgroundColor: me?.color }}>
            {me?.name[0].toUpperCase()}
          </div>
          <div>
            <div className="text-xs text-indigo-300 font-bold uppercase tracking-widest flex items-center gap-2">
              Room: {currentGameState?.roomCode}
              {mode === 'online' && (
                <button 
                  onClick={handleCopyCode}
                  className="hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
                  title="Copy Room Code"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              )}
            </div>
            <div className="font-black text-sm">{me?.name}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {mode === 'online' && (
            <div className="flex items-center gap-2 bg-black/20 px-4 py-2 rounded-xl border border-white/5">
              <Timer size={16} className="text-indigo-400" />
              <span className="font-mono font-bold text-lg">{currentGameState?.timer}s</span>
            </div>
          )}
          <div className="hidden sm:flex items-center gap-2 bg-black/20 px-4 py-2 rounded-xl border border-white/5">
            <Trophy size={16} className="text-yellow-400" />
            <span className="font-bold">{me?.score}</span>
          </div>
          {mode === 'online' && (
            <button
              onClick={handleExitLobby}
              className="p-2 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors border border-transparent hover:border-red-500/20"
              title="Leave Game"
            >
              <XCircle size={20} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Main Game Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center">
          <AnimatePresence mode="wait">
            {currentGameState?.status === 'lobby' && (
              <motion.div 
                key="lobby"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl"
              >
                <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 shadow-2xl">
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-3xl font-black tracking-tighter">LOBBY</h2>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2 text-indigo-300 font-bold">
                        <Users size={20} />
                        <span>{players.length} / 10</span>
                      </div>
                      {mode === 'online' && (
                        <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-lg border border-white/10">
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Code:</span>
                          <span className="font-mono font-bold text-white">{currentGameState?.roomCode}</span>
                          <button 
                            onClick={handleCopyCode}
                            className="hover:text-white transition-colors p-1"
                          >
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-indigo-400" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                    {players.map(p => (
                      <motion.div 
                        key={p.id} 
                        whileHover={{ y: -2 }}
                        className="flex items-center gap-4 p-4 bg-black/20 rounded-2xl border border-white/5 transition-colors hover:bg-white/5"
                      >
                        <motion.div 
                          whileHover={{ scale: 1.1, rotate: 5 }}
                          transition={{ type: "spring", stiffness: 400, damping: 10 }}
                          className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-black shadow-lg cursor-pointer" 
                          style={{ backgroundColor: p.color }}
                        >
                          {p.name[0].toUpperCase()}
                        </motion.div>
                        <div className="flex-1 font-bold">{p.name}</div>
                        {p.isReady ? (
                          <div className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-500/30">Ready</div>
                        ) : (
                          <div className="bg-white/5 text-white/40 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/10">Waiting</div>
                        )}
                      </motion.div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex gap-4">
                      <button
                        onClick={() => mode === 'online' ? send({ type: 'ready' }) : null}
                        className={`flex-1 p-5 rounded-2xl font-black text-lg transition-all shadow-xl ${
                          me?.isReady ? 'bg-indigo-900 text-indigo-400 border border-indigo-500/30' : 'bg-white text-indigo-950 hover:bg-indigo-50 shadow-white/10'
                        }`}
                      >
                        {me?.isReady ? 'NOT READY' : 'READY UP'}
                      </button>
                      {players.length >= 3 && mode === 'online' && (
                        <button
                          onClick={() => send({ type: 'start_game' })}
                          className="p-5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-emerald-500/20"
                        >
                          START
                        </button>
                      )}
                    </div>
                    
                    {mode === 'online' && (
                      <button
                        onClick={handleExitLobby}
                        className="w-full p-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-2xl font-bold text-sm transition-all"
                      >
                        EXIT LOBBY
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {currentGameState?.status === 'reveal' && (
              <motion.div 
                key="reveal"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-20"
              >
                <div className="text-indigo-300 font-black uppercase tracking-[0.3em] mb-4">Your Secret Word</div>
                <div className="text-7xl sm:text-9xl font-black tracking-tighter text-white drop-shadow-2xl mb-8">
                  {me?.word}
                </div>
                <div className="bg-white/10 backdrop-blur-md px-8 py-4 rounded-full inline-flex items-center gap-3 border border-white/20">
                  <AlertCircle size={20} className="text-indigo-300" />
                  <span className="font-bold text-sm">Don't let anyone see!</span>
                </div>
              </motion.div>
            )}

            {currentGameState?.status === 'clue' && (
              <motion.div 
                key="clue"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-lg"
              >
                <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 shadow-2xl text-center">
                  <h2 className="text-3xl font-black mb-2 tracking-tighter">GIVE A CLUE</h2>
                  <p className="text-indigo-300 mb-8 font-medium">Describe your word without saying it.</p>
                  
                  {me?.clue ? (
                    <div className="p-8 bg-indigo-500/20 rounded-3xl border border-indigo-500/30 italic text-2xl font-bold">
                      "{me.clue}"
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="Type your clue..."
                        value={clue}
                        onChange={(e) => setClue(e.target.value)}
                        className="w-full p-5 bg-black/20 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all text-center text-xl font-bold"
                      />
                      <button
                        onClick={() => {
                          if (clue.trim() && mode === 'online') {
                            send({ type: 'submit_clue', clue });
                            setClue('');
                          }
                        }}
                        className="w-full p-5 bg-indigo-500 hover:bg-indigo-400 rounded-2xl font-black text-lg transition-all shadow-xl shadow-indigo-500/30"
                      >
                        SUBMIT CLUE
                      </button>

                      <div className="pt-4">
                        {!hintText ? (
                          <button
                            onClick={handleRequestHint}
                            disabled={isGeneratingHint}
                            className="flex items-center justify-center gap-2 mx-auto text-indigo-300 hover:text-white transition-colors text-sm font-bold"
                          >
                            {isGeneratingHint ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Sparkles size={16} />
                            )}
                            {isGeneratingHint ? 'Generating Hint...' : 'Need a Hint?'}
                          </button>
                        ) : (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-sm text-indigo-200 italic"
                          >
                            <div className="flex items-center justify-center gap-2 mb-1 text-[10px] font-black uppercase tracking-widest text-indigo-400">
                              <Sparkles size={10} />
                              AI Hint
                            </div>
                            {hintText}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {currentGameState?.status === 'discussion' && (
              <motion.div 
                key="discussion"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full max-w-4xl"
              >
                <div className="flex flex-col items-center mb-8">
                  <div className="flex items-center gap-3 bg-white/10 px-6 py-3 rounded-2xl border border-white/20 shadow-xl mb-4">
                    <Timer className={currentGameState.timer <= 10 ? "text-red-400 animate-pulse" : "text-indigo-400"} />
                    <span className={`text-4xl font-mono font-black ${currentGameState.timer <= 10 ? "text-red-400" : "text-white"}`}>
                      {Math.floor(currentGameState.timer / 60)}:{(currentGameState.timer % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <h2 className="text-2xl font-black tracking-tight text-indigo-200">DISCUSSION PHASE</h2>
                  {currentGameState.timer === 0 && (
                    <motion.p 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="text-red-400 font-black mt-2 text-xl"
                    >
                      TIME'S UP!
                    </motion.p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {players.map(p => (
                    <motion.div 
                      key={p.id} 
                      whileHover={{ y: -5 }}
                      className="bg-white/5 p-6 rounded-3xl border border-white/10 shadow-xl flex flex-col items-center text-center transition-colors hover:bg-white/10"
                    >
                      <motion.div 
                        whileHover={{ scale: 1.1, rotate: -5 }}
                        transition={{ type: "spring", stiffness: 400, damping: 10 }}
                        className="w-16 h-16 rounded-2xl mb-4 flex items-center justify-center text-2xl font-black shadow-lg cursor-pointer" 
                        style={{ backgroundColor: p.color }}
                      >
                        {p.name[0].toUpperCase()}
                      </motion.div>
                      <div className="font-black mb-2">{p.name}</div>
                    </motion.div>
                  ))}
                </div>
                {mode === 'offline' && (
                  <div className="mt-8 flex justify-center">
                    <button
                      onClick={() => setOfflineGameState(prev => prev ? { ...prev, status: 'voting' } : null)}
                      className="p-5 bg-indigo-500 hover:bg-indigo-400 rounded-2xl font-black text-lg transition-all shadow-xl"
                    >
                      GO TO VOTING
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {currentGameState?.status === 'voting' && (
              <motion.div 
                key="voting"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-2xl"
              >
                <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 shadow-2xl text-center">
                  <h2 className="text-3xl font-black mb-2 tracking-tighter">WHO IS THE IMPOSTER?</h2>
                  <p className="text-indigo-300 mb-4 font-medium">
                    {mode === 'offline' 
                      ? `Find all ${Object.values(currentGameState.players).filter(p => p.isImposter).length} imposters!` 
                      : 'Vote for the person with the wrong word.'}
                  </p>
                  
                  {mode === 'offline' && (
                    <div className="flex justify-center gap-2 mb-8">
                      {Object.values(currentGameState.players).filter(p => p.isImposter).map((p, i) => (
                        <div 
                          key={i} 
                          className={`w-3 h-3 rounded-full border transition-all duration-500 ${
                            checkedOfflinePlayerIds.filter(id => currentGameState.players[id].isImposter).length > i
                              ? 'bg-red-500 border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.5)] scale-125'
                              : 'bg-white/10 border-white/20'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    {players.map(p => (
                      <button
                        key={p.id}
                        disabled={mode === 'online' && !!me?.vote}
                        onClick={() => {
                          if (mode === 'online') {
                            send({ type: 'vote', targetId: p.id });
                          } else {
                            if (checkedOfflinePlayerIds.includes(p.id)) return;
                            setRevealedPlayerId(p.id);
                          }
                        }}
                        className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${
                          revealedPlayerId === p.id 
                            ? 'bg-indigo-500 border-white shadow-[0_0_20px_rgba(99,102,241,0.6)] scale-105 z-10' 
                            : checkedOfflinePlayerIds.includes(p.id)
                              ? currentGameState.players[p.id].isImposter 
                                ? 'bg-red-500/40 border-red-500/50 opacity-60'
                                : 'bg-emerald-500/20 border-emerald-500/30 opacity-40'
                              : 'bg-black/20 border-white/5 hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl flex-shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="font-bold truncate">{p.name}</span>
                        {checkedOfflinePlayerIds.includes(p.id) && (
                          <div className="ml-auto flex items-center gap-1">
                            {currentGameState.players[p.id].isImposter ? (
                              <>
                                <XCircle size={16} className="text-red-400" />
                                <span className="text-[10px] font-black uppercase text-red-400">Imposter</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={16} className="text-emerald-400" />
                                <span className="text-[10px] font-black uppercase text-emerald-400">Safe</span>
                              </>
                            )}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {revealedPlayerId && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="mt-8 p-6 bg-white/10 rounded-3xl border border-white/20 text-center"
                    >
                      <div className="text-sm text-indigo-300 font-bold uppercase mb-2">Result for {currentGameState.players[revealedPlayerId].name}</div>
                      <div className={`text-4xl font-black mb-6 ${currentGameState.players[revealedPlayerId].isImposter ? 'text-red-400' : 'text-emerald-400'}`}>
                        {currentGameState.players[revealedPlayerId].isImposter ? 'IMPOSTER!' : 'NOT THE IMPOSTER'}
                      </div>
                      <button
                        onClick={() => {
                          const target = currentGameState.players[revealedPlayerId];
                          const newChecked = [...checkedOfflinePlayerIds, revealedPlayerId];
                          setCheckedOfflinePlayerIds(newChecked);
                          
                          const imposters = Object.values(currentGameState.players).filter(p => p.isImposter);
                          const foundImposters = imposters.filter(p => newChecked.includes(p.id));
                          
                          if (foundImposters.length === imposters.length) {
                            setOfflineGameState(prev => prev ? { 
                              ...prev, 
                              status: 'results', 
                              winner: 'players' 
                            } : null);
                          }
                          setRevealedPlayerId(null);
                        }}
                        className="p-4 bg-white text-indigo-950 rounded-xl font-black w-full"
                      >
                        {currentGameState.players[revealedPlayerId].isImposter 
                          ? (Object.values(currentGameState.players).filter(p => p.isImposter).length > checkedOfflinePlayerIds.filter(id => currentGameState.players[id].isImposter).length + 1)
                            ? 'FOUND ONE! KEEP GOING' 
                            : 'FOUND ALL! SEE RESULTS'
                          : 'KEEP SEARCHING'}
                      </button>
                    </motion.div>
                  )}

                  {mode === 'offline' && !revealedPlayerId && (
                    <button 
                      onClick={() => {
                        const playerList = Object.values(currentGameState.players);
                        const currentIndex = playerList.findIndex(p => p.id === me?.id);
                        const nextIndex = (currentIndex + 1) % playerList.length;
                        setOfflineRevealIndex(nextIndex);
                      }}
                      className="mt-4 text-xs font-bold text-indigo-400 hover:text-white transition-all"
                    >
                      SWITCH TO NEXT PLAYER TO VOTE
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {currentGameState?.status === 'results' && (
              <motion.div 
                key="results"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                <div className="text-indigo-300 font-black uppercase tracking-[0.3em] mb-4">Game Over</div>
                <h2 className="text-7xl sm:text-9xl font-black tracking-tighter text-white mb-8 uppercase italic">
                  {currentGameState.winner === 'imposter' ? 'Imposter Wins!' : 'Players Win!'}
                </h2>
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-white/10 p-6 rounded-3xl border border-white/20 inline-block">
                    <div className="text-sm text-indigo-300 font-bold uppercase mb-2">The Words Were</div>
                    <div className="flex gap-8 text-2xl font-black">
                      <div>Players: <span className="text-white">{currentGameState.wordA}</span></div>
                      <div>Imposter: <span className="text-red-400">{currentGameState.wordB}</span></div>
                    </div>
                  </div>

                  {mode === 'offline' && (
                    <div className="w-full max-w-2xl mt-8">
                      <div className="text-sm text-indigo-300 font-bold uppercase mb-4 tracking-widest">Player Roles</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {players.map(p => (
                          <motion.div 
                            key={p.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 ${
                              p.isImposter 
                                ? 'bg-red-500/10 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]' 
                                : 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                            }`}
                          >
                            <div className="w-12 h-12 rounded-xl shadow-lg" style={{ backgroundColor: p.color }} />
                            <div className="font-black text-sm text-white">{p.name}</div>
                            <div className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                              p.isImposter ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
                            }`}>
                              {p.isImposter ? 'Imposter' : 'Player'}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mode === 'offline' && (
                    <button
                      onClick={() => setOfflineGameState(null)}
                      className="mt-8 p-5 bg-white text-indigo-950 rounded-2xl font-black text-lg transition-all"
                    >
                      PLAY AGAIN
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Chat Sidebar */}
        {mode === 'online' && (
          <div className="w-full lg:w-80 bg-black/30 backdrop-blur-xl border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col h-64 lg:h-auto">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-widest text-indigo-300">
                <MessageSquare size={14} />
                <span>Live Chat</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className="text-sm">
                  <span className="font-black mr-2" style={{ color: msg.color }}>{msg.name}:</span>
                  <span className="text-indigo-100">{msg.text}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendChat} className="p-4 bg-black/20">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  className="w-full p-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all text-sm pr-10"
                />
                <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 hover:text-indigo-300">
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Voice Chat */}
      {mode === 'online' && (
        <VoiceChat 
          onAudioData={(data) => send({ type: 'voice', data })} 
          incomingAudio={incomingAudio}
        />
      )}
    </div>
  );
}
