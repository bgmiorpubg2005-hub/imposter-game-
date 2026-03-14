import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';

interface VoiceChatProps {
  roomCode: string;
  playerId: string;
  players: string[]; // List of other player IDs
}

export const VoiceChat: React.FC<VoiceChatProps> = ({ roomCode, playerId, players }) => {
  const [isMuted, setIsMuted] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const remoteStreams = useRef<Record<string, MediaStream>>({});
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);

  const iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    if (isJoined) {
      setupVoice();
    } else {
      cleanupVoice();
    }
    return () => {
      cleanupVoice();
    };
  }, [isJoined]);

  const cleanupVoice = async () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    remoteStreams.current = {};
    setIsMuted(true);
  };

  const setupVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      // Initially muted
      stream.getAudioTracks().forEach(t => t.enabled = false);

      // Signaling listener
      const signalingRef = collection(db, 'rooms', roomCode, 'signaling');
      
      onSnapshot(signalingRef, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          const data = change.doc.data();
          const [from, to] = change.doc.id.split('_to_');
          
          if (to !== playerId) return;

          if (change.type === 'added' || change.type === 'modified') {
            let pc = peerConnections.current[from];
            
            if (!pc) {
              pc = createPeerConnection(from);
            }

            if (data.offer && !pc.remoteDescription) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await updateDoc(change.doc.ref, { answer: { type: answer.type, sdp: answer.sdp } });
            } else if (data.answer && pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }

            if (data.iceCandidates) {
              data.iceCandidates.forEach((candidate: any) => {
                pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding ice candidate", e));
              });
            }
          }
        });
      });

      // Initiate calls to others
      players.forEach(otherId => {
        if (otherId === playerId) return;
        // Deterministic: lower ID initiates to higher ID
        if (playerId < otherId) {
          initiateCall(otherId);
        }
      });

    } catch (err) {
      console.error('Error setting up voice:', err);
    }
  };

  const createPeerConnection = (otherId: string) => {
    const pc = new RTCPeerConnection(iceConfig);
    peerConnections.current[otherId] = pc;

    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const signalId = playerId < otherId ? `${playerId}_to_${otherId}` : `${otherId}_to_${playerId}`;
        const signalRef = doc(db, 'rooms', roomCode, 'signaling', signalId);
        updateDoc(signalRef, {
          iceCandidates: arrayUnion(event.candidate.toJSON())
        }).catch(() => {
          // If doc doesn't exist yet, we'll wait for the next candidate or the offer creation
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      remoteStreams.current[otherId] = stream;
      
      // Play remote stream
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play();
      
      setActiveSpeakers(prev => [...new Set([...prev, otherId])]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setActiveSpeakers(prev => prev.filter(id => id !== otherId));
      }
    };

    return pc;
  };

  const initiateCall = async (otherId: string) => {
    const pc = createPeerConnection(otherId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const signalId = `${playerId}_to_${otherId}`;
    await setDoc(doc(db, 'rooms', roomCode, 'signaling', signalId), {
      offer: { type: offer.type, sdp: offer.sdp },
      iceCandidates: []
    });
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !newMuted);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex items-center gap-3">
      {!isJoined ? (
        <button
          onClick={() => setIsJoined(true)}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-black shadow-xl shadow-indigo-500/20 transition-all"
        >
          <Volume2 size={20} />
          JOIN VOICE
        </button>
      ) : (
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-xl p-2 rounded-full border border-white/10 shadow-2xl">
          <button
            onClick={toggleMute}
            className={`p-3 rounded-full transition-all ${
              isMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
            }`}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          
          <div className="flex -space-x-2 px-2">
            {activeSpeakers.map(id => (
              <div 
                key={id}
                className="w-8 h-8 rounded-full border-2 border-emerald-500 bg-indigo-500 flex items-center justify-center text-[10px] font-black text-white"
                title="Speaking"
              >
                {id[0].toUpperCase()}
              </div>
            ))}
          </div>

          <button
            onClick={() => setIsJoined(false)}
            className="p-3 text-white/40 hover:text-white transition-colors"
          >
            <VolumeX size={20} />
          </button>
        </div>
      )}
    </div>
  );
};
