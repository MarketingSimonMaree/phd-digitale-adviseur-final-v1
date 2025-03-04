"use client";

import type { StartAvatarResponse } from "@heygen/streaming-avatar";
import StreamingAvatar, { 
  AvatarQuality, 
  StreamingEvents, 
  TaskMode, 
  TaskType, 
  VoiceEmotion 
} from "@heygen/streaming-avatar";
import { Room } from "livekit-client";
import {
  Button,
  Card,
  CardBody,
  Spinner,
} from "@nextui-org/react";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, usePrevious } from "ahooks";
import ChatMessages from './ChatMessages';
import { Mic, MicOff } from "lucide-react";

// Vaste waardes
const AVATAR_ID = '00e7b435191b4dcc85936073262b9aa8';
const KNOWLEDGE_BASE_ID = '6a065e56b4a74f7a884d8323e10ceb90';
const LANGUAGE = 'nl';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

interface Props {
  children?: React.ReactNode; // Voeg ? toe om het optioneel te maken
}

export default function InteractiveAvatar({ children }: Props) {
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [data, setData] = useState<StartAvatarResponse>();
  const [text, setText] = useState<string>("");
  const [messages, setMessages] = useState<Array<{
    text: string;
    sender: 'avatar' | 'user';
  }>>([]);
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const [chatMode, setChatMode] = useState("text_mode");
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [currentAvatarMessage, setCurrentAvatarMessage] = useState('');
  const [isProcessingMessage, setIsProcessingMessage] = useState(false);
  const messageBuffer = useRef('');  // Nieuwe ref voor het bufferen van berichten
  const [showInput, setShowInput] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const [showToast, setShowToast] = useState(false);  // Voeg deze toe bovenaan bij de andere state

  async function fetchAccessToken() {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      const token = await response.text();
      console.log("Access Token:", token);
      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
    }
    return "";
  }

  async function startSession() {
    setIsLoadingSession(true);
    try {
      const newToken = await fetchAccessToken();

      // Controleer microfoon toegang vooraf
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop de stream direct weer
        stream.getTracks().forEach(track => track.stop());
      } catch (error) {
        console.error("Microfoon toegang geweigerd:", error);
        setDebug("Microfoon toegang geweigerd. Controleer je browser instellingen.");
        throw new Error("Microfoon toegang geweigerd");
      }

      // Maak een nieuwe StreamingAvatar instantie met expliciete configuratie
      avatar.current = new StreamingAvatar({
        token: newToken,
        debug: true,
        autoplay: true
      } as any);

      // Mount de avatar
      if (mediaStream.current && avatar.current) {
        (avatar.current as any).mount(mediaStream.current);
        
        // Start de avatar
        (avatar.current as any).start();
      }

      // Event listeners toevoegen
      avatar.current.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
        console.log("Avatar started talking", e);
      });
      avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
        console.log("Avatar stopped talking", e);
      });
      avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        endSession();
      });
      avatar.current?.on(StreamingEvents.STREAM_READY, (event) => {
        console.log("Stream ready:", event.detail);
        setStream(event.detail);
      });
      avatar.current?.on(StreamingEvents.USER_START, (event) => {
        console.log("User started talking:", event);
        setIsUserTalking(true);
      });
      avatar.current?.on(StreamingEvents.USER_STOP, (event) => {
        console.log("User stopped talking:", event);
        setIsUserTalking(false);
      });
      avatar.current?.on(StreamingEvents.AVATAR_TALKING_MESSAGE, (event) => {
        if (event.detail?.message) {
          messageBuffer.current += event.detail.message;
          
          // Check voor complete zinnen
          const sentences = messageBuffer.current.match(/[^.!?]+[.!?]+/g);
          if (sentences) {
            sentences.forEach(sentence => {
              setMessages(prev => [...prev, {
                text: sentence.trim(),
                sender: 'avatar'
              }]);
            });
            // Bewaar eventuele onvolledige zin
            messageBuffer.current = messageBuffer.current.replace(/[^.!?]+[.!?]+/g, '');
          }
        }
      });
      avatar.current?.on(StreamingEvents.AVATAR_END_MESSAGE, () => {
        if (messageBuffer.current.trim()) {
          setMessages(prev => [...prev, {
            text: messageBuffer.current.trim(),
            sender: 'avatar'
          }]);
          messageBuffer.current = '';
        }
      });
      avatar.current?.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
        console.log("User talking event in mode:", chatMode); // Debug log
        if (event.detail?.message && chatMode === "voice_mode") {
          setMessages(prev => [...prev, {
            text: event.detail.message,
            sender: 'user'
          }]);
        }
      });

      // Start de avatar met de juiste configuratie
      const res = await avatar.current.createStartAvatar({
        quality: AvatarQuality.High,
        avatarName: AVATAR_ID,
        knowledgeId: KNOWLEDGE_BASE_ID,
        language: LANGUAGE,
        disableIdleTimeout: true,
        voice: {
          voiceId: process.env.NEXT_PUBLIC_AVATAR_VOICE_ID
        }
      });

      setData(res);
      
      // Wacht even voordat we voice chat starten
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Start voice chat direct
      await avatar.current?.startVoiceChat({
        useSilencePrompt: false
      });
      
      // Zet standaard op text mode
      setChatMode("text_mode");
    } catch (error) {
      console.error("Error starting avatar session:", error);
      setDebug("Fout bij starten sessie: " + (error as Error).message);
      avatar.current = null;
      setStream(undefined);
    } finally {
      setIsLoadingSession(false);
    }
  }

  const handleSpeak = async (text: string) => {
    try {
      if (!avatar.current) {
        throw new Error("Avatar is not initialized");
      }

      await avatar.current.speak({ 
        text: text,
        taskType: TaskType.TALK,
        taskMode: TaskMode.SYNC 
      });
    } catch (e) {
      // Optie 1: Type assertion
      const error = e as Error;
      setDebug(error.message);
      console.error(error);

      // OF Optie 2: Type check
      if (e instanceof Error) {
        setDebug(e.message);
        console.error(e);
      } else {
        setDebug('An unknown error occurred');
        console.error('Unknown error:', e);
      }
    }
  };

  async function endSession() {
    await avatar.current?.stopAvatar();
    setStream(undefined);
  }

  const handleChangeChatMode = useMemoizedFn(async (v) => {
    if (v === chatMode || !avatar.current) {
      return;
    }
    
    try {
      if (v === "text_mode") {
        await avatar.current.closeVoiceChat();
        setIsUserTalking(false); // Reset spraak status
      } else {
        // Reset text input als we naar voice mode gaan
        setText('');
        await avatar.current.startVoiceChat({
          useSilencePrompt: false
        });
      }
      setChatMode(v);
      console.log("Chat mode changed to:", v); // Debug log
    } catch (error) {
      console.error("Error changing chat mode:", error);
      setDebug("Fout bij wisselen chat modus: " + (error as Error).message);
    }
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Voorkom nieuwe regel
      handleSendMessage();
    }
  };

  const handleDisabledClick = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  useEffect(() => {
    if (!avatar.current) return;

    const handleTalkingMessage = (event: any) => {
      console.log("Avatar talking message in useEffect:", event.detail); // Debug log
      if (event.detail?.message) {
        messageBuffer.current += event.detail.message;
        
        // Check voor complete zinnen
        const sentences = messageBuffer.current.match(/[^.!?]+[.!?]+/g);
        if (sentences) {
          sentences.forEach(sentence => {
            console.log("Adding avatar sentence in useEffect:", sentence.trim()); // Debug log
            setMessages(prev => [...prev, {
              text: sentence.trim(),
              sender: 'avatar'
            }]);
          });
          // Bewaar eventuele onvolledige zin
          messageBuffer.current = messageBuffer.current.replace(/[^.!?]+[.!?]+/g, '');
        }
      }
    };

    const handleEndMessage = () => {
      console.log("Avatar end message in useEffect, buffer:", messageBuffer.current); // Debug log
      if (messageBuffer.current.trim()) {
        setMessages(prev => [...prev, {
          text: messageBuffer.current.trim(),
          sender: 'avatar'
        }]);
        messageBuffer.current = '';
      }
    };

    avatar.current.on(StreamingEvents.AVATAR_TALKING_MESSAGE, handleTalkingMessage);
    avatar.current.on(StreamingEvents.AVATAR_END_MESSAGE, handleEndMessage);

    return () => {
      if (avatar.current) {
        (avatar.current as any).stop();
        avatar.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
        setDebug("Playing");
      };
    }
  }, [mediaStream, stream]);

  const handleSendMessage = async () => {
    if (text.trim() === '') return;
    
    const userMessage = text.trim();
    setText('');
    
    // Alleen voor getypte berichten
    setMessages(prev => [...prev, {
      text: userMessage,
      sender: 'user'
    }]);

    if (avatar.current) {
      setIsLoadingRepeat(true);
      try {
        await avatar.current.speak({ 
          text: userMessage, 
          taskType: TaskType.TALK,
          taskMode: TaskMode.SYNC 
        });
      } catch (e) {
        setDebug((e as Error).message);
      } finally {
        setIsLoadingRepeat(false);
      }
    }
  };

  const handleAvatarResponse = (userMessage: string) => {
    // Simuleer een antwoord van de avatar
    const avatarMessage = `Avatar antwoord op: "${userMessage}"`; // Dit kan je aanpassen
    setMessages((prevMessages) => [...prevMessages, {
      text: avatarMessage,
      sender: 'avatar'
    }]);
  };

  const handleMuteClick = async () => {
    if (!stream || !avatar.current) return;

    try {
      if (chatMode === "text_mode") {
        // Switch naar voice mode
        await avatar.current.startVoiceChat({
          useSilencePrompt: false
        });
        setChatMode("voice_mode");
        setIsMuted(false);
      } else {
        // Switch naar text mode
        await avatar.current.closeVoiceChat();
        setChatMode("text_mode");
        setIsMuted(true);
      }
    } catch (error) {
      console.error('Error toggling mode/mute:', error);
      setDebug('Fout bij wisselen modus: ' + (error as Error).message);
    }
  };

  useEffect(() => {
    // Vraag microfoon toegang wanneer de stream start
    async function setupMicrophone() {
      if (stream) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioTrackRef.current = audioStream.getAudioTracks()[0];
        } catch (err) {
          console.error("Kon geen toegang krijgen tot de microfoon:", err);
        }
      }
    }
    
    setupMicrophone();
    
    // Cleanup
    return () => {
      if (audioTrackRef.current) {
        audioTrackRef.current.stop();
      }
    };
  }, [stream]);

  useEffect(() => {
    if (!avatar.current) return;

    const handleUserTalking = (event: any) => {
      // Alleen toevoegen als we in voice mode zijn
      if (chatMode === "voice_mode" && event.detail?.message) {
        setMessages(prev => [...prev, {
          text: event.detail.message,
          sender: 'user'
        }]);
      }
    };

    avatar.current.on(StreamingEvents.USER_TALKING_MESSAGE, handleUserTalking);

    return () => {
      if (avatar.current) {
        avatar.current.off(StreamingEvents.USER_TALKING_MESSAGE, handleUserTalking);
      }
    };
  }, [chatMode]); // Voeg chatMode toe aan dependencies

  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 w-full h-full">
        {stream ? (
          <video
            ref={mediaStream}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          >
            <track kind="captions" />
          </video>
        ) : (
          <img 
            src="https://cdn.shopify.com/s/files/1/0524/8794/6424/files/preview_target.webp?v=1740493527"
            alt="Digital Assistant Preview"
            className="w-full h-full object-cover"
          />
        )}
      </div>

      <div className="absolute inset-0 flex flex-col">
        {stream && (
          <div className="absolute top-6 right-6 z-10">
            <button
              onClick={endSession}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-black/20 hover:bg-[#ce861b] text-white transition-colors group relative"
            >
              ✕
              <span className="absolute right-full mr-2 whitespace-nowrap bg-black/75 text-white px-3 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                Beëindig gesprek
              </span>
            </button>
          </div>
        )}

        {isLoadingSession && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="text-center">
              <div className="mb-4">
                <Spinner color="warning" size="lg" />
              </div>
              <div className="text-white text-2xl font-medium px-4 drop-shadow-lg">
                Even geduld, de digitale adviseur wordt geladen...
              </div>
            </div>
          </div>
        )}

        {!stream && !isLoadingSession && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <Button
              className="bg-gradient-to-tr from-amber-500 to-amber-300 text-white rounded-lg"
              size="lg"
              onClick={startSession}
            >
              Start gesprek
            </Button>
          </div>
        )}

        <div className="mt-auto centered-container">
          <div className="space-y-4 p-6">
            {stream && messages.length > 0 && (
              <ChatMessages 
                messages={messages} 
                onClear={() => setMessages([])} 
              />
            )}
            
            <div className="absolute bottom-24 left-4 flex gap-2">
              <Button
                className={`flex items-center justify-center gap-2 h-12 transition-all ${
                  chatMode === "text_mode" 
                    ? "bg-[#ce861b] text-white w-32"
                    : "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm w-12"
                }`}
                onClick={() => stream ? handleChangeChatMode("text_mode") : handleDisabledClick()}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 5h16v10H4z" />
                  <path d="M8 15v2m4-2v2m4-2v2" />
                  <path d="M7 9h2m2 0h2m2 0h2" />
                </svg>
                {chatMode === "text_mode" && <span>Typen</span>}
              </Button>
              <Button
                className={`flex items-center justify-center gap-2 h-12 transition-all ${
                  chatMode === "voice_mode" 
                    ? "bg-[#ce861b] text-white w-32"
                    : "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm w-12"
                }`}
                onClick={() => stream ? handleChangeChatMode("voice_mode") : handleDisabledClick()}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                </svg>
                {chatMode === "voice_mode" && <span>Spreken</span>}
              </Button>
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative flex items-center">
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={chatMode === "voice_mode" ? "Schakel naar typen om een bericht te typen..." : "Type hier uw bericht..."}
                    className="w-full px-6 py-3 text-lg rounded-[12px] bg-white/90 backdrop-blur-sm pr-16"
                    disabled={!stream || chatMode === "voice_mode"}
                  />
                  
                  {text && (
                    <div 
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      style={{ zIndex: 50 }}
                    >
                      <button
                        onClick={handleSendMessage}
                        disabled={isLoadingRepeat || !stream}
                        className="w-12 h-12 flex items-center justify-center rounded-full bg-[#ce861b] hover:bg-[#b77516] transition-colors"
                      >
                        {isLoadingRepeat ? (
                          <Spinner size="sm" color="white" />
                        ) : (
                          <svg 
                            viewBox="0 0 24 24" 
                            className="w-6 h-6 text-white fill-current"
                          >
                            <path d="M5 12h14M13 5l7 7-7 7" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                
                <button
                  onClick={handleMuteClick}
                  className={`p-3 rounded-full transition-colors shadow-lg ${
                    chatMode === "voice_mode" 
                      ? "bg-[#ce861b] hover:bg-[#b77516]" 
                      : "bg-gray-500 hover:bg-gray-600"
                  }`}
                  title={chatMode === "voice_mode" ? "Schakel over naar typen" : "Activeer microfoon"}
                >
                  {chatMode === "voice_mode" ? (
                    <Mic className="h-6 w-6 text-white" />
                  ) : (
                    <MicOff className="h-6 w-6 text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="font-mono text-right">
        <span className="font-bold">Console:</span>
        <br />
        {debug}
      </p>

      {showToast && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-black/75 text-white px-4 py-2 rounded">
          Start eerst de avatar om deze functie te gebruiken
        </div>
      )}
    </div>
  );
}
