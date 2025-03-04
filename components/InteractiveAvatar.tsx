"use client";

import StreamingAvatar, { 
  AvatarQuality, 
  StreamingEvents, 
  TaskMode, 
  TaskType,
  VoiceEmotion
} from "@heygen/streaming-avatar";
import type { StartAvatarResponse, SpeakRequest } from "@heygen/streaming-avatar";
import {
  Button,
  Spinner,
} from "@nextui-org/react";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn } from "ahooks";
import { Mic, MicOff, Send, X } from "lucide-react";
import ChatMessages from './ChatMessages';

// Constants
const AVATAR_ID = '00e7b435191b4dcc85936073262b9aa8';
const KNOWLEDGE_BASE_ID = '6a065e56b4a74f7a884d8323e10ceb90';
const LANGUAGE = 'nl';

interface Props {
  children?: React.ReactNode;
}

// Define message type for internal use
interface Message {
  text: string;
  sender: 'avatar' | 'user';
}

export default function InteractiveAvatar({ children }: Props) {
  // State management
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [debug, setDebug] = useState<string>("");
  const [data, setData] = useState<StartAvatarResponse>();
  const [text, setText] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatMode, setChatMode] = useState("text_mode");
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [showToast, setShowToast] = useState<boolean>(false);
  
  // Refs
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const messageBuffer = useRef<string>('');
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);

  // Fetch access token
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
      setDebug(`Token error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return "";
  }

  // Start avatar session
  async function startSession() {
    setIsLoadingSession(true);
    try {
      const newToken = await fetchAccessToken();

      // Check microphone access first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (error) {
        console.error("Microphone access denied:", error);
        setDebug("Microphone access denied. Check browser settings.");
        throw new Error("Microphone access denied");
      }

      // Create new StreamingAvatar instance with proper config
      avatar.current = new StreamingAvatar({
        token: newToken
        // Only include the token as this is the only valid property
        // in StreamingAvatarApiConfig according to the type definition
      });

      // Add event listeners for avatar feedback
      setupAvatarEventListeners();

      // Mount the avatar - use type assertion if method exists but isn't in type definition
      if (mediaStream.current && avatar.current) {
        // The SDK might have evolved and the types might not be up to date
        // We'll need to check the actual API implementation
        if (typeof (avatar.current as any).mount === 'function') {
          (avatar.current as any).mount(mediaStream.current);
        }
        
        // Similarly for start method
        if (typeof (avatar.current as any).start === 'function') {
          (avatar.current as any).start();
        }
      }

      // Start the avatar with minimal configuration to satisfy type checking
      const res = await (avatar.current as any).createStartAvatar({
        quality: AvatarQuality.High,
        avatarName: AVATAR_ID,
        knowledgeId: KNOWLEDGE_BASE_ID,
        language: LANGUAGE,
        disableIdleTimeout: true  // Using camelCase as per TypeScript convention
      });
      
      setData(res);
      
      // Set stream
      if (avatar.current.mediaStream) {
        setStream(avatar.current.mediaStream);
      }

      // Send welcome message with proper request format
      setTimeout(() => {
        if (avatar.current) {
          (avatar.current as any).speak({
            text: "Hallo! Ik ben je digitale adviseur. Hoe kan ik je helpen?",
            taskType: TaskType.TALK, // Use TALK for LLM-generated responses
            taskMode: TaskMode.SYNC  // Wait for message to complete
          }).catch((error: unknown) => {
            console.error("Error sending welcome message:", error);
            setDebug(`Welcome message error: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      }, 1000);
      
      // Set default mode to text
      setChatMode("text_mode");
      
    } catch (error) {
      console.error("Error starting avatar session:", error);
      setDebug(`Session error: ${error instanceof Error ? error.message : String(error)}`);
      avatar.current = null;
      setStream(null);
    } finally {
      setIsLoadingSession(false);
    }
  }

  // Set up event listeners for the avatar based on SDK reference
  function setupAvatarEventListeners() {
    if (!avatar.current) return;
    
    // AVATAR_START_TALKING: Emitted when the avatar starts speaking
    avatar.current.on(StreamingEvents.AVATAR_START_TALKING, (event) => {
      console.log("Avatar started talking", event);
    });
    
    // AVATAR_STOP_TALKING: Emitted when the avatar stops speaking
    avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, (event) => {
      console.log("Avatar stopped talking", event);
    });
    
    // STREAM_DISCONNECTED: Triggered when the stream disconnects
    avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
      console.log("Stream disconnected");
      endSession();
    });
    
    // STREAM_READY: Indicates that the stream is ready for display
    avatar.current.on(StreamingEvents.STREAM_READY, (event) => {
      console.log("Stream ready:", event.detail);
      setStream(event.detail);
    });
    
    // USER_START: Indicates when the user starts speaking
    avatar.current.on(StreamingEvents.USER_START, (event) => {
      console.log("User started talking", event);
      setIsUserTalking(true);
    });
    
    // USER_STOP: Indicates when the user stops speaking
    avatar.current.on(StreamingEvents.USER_STOP, (event) => {
      console.log("User stopped talking", event);
      setIsUserTalking(false);
    });
    
    // USER_SILENCE: Indicates when the user is silent
    avatar.current.on(StreamingEvents.USER_SILENCE, () => {
      console.log("User is silent");
    });
    
    // AVATAR_TALKING_MESSAGE: Triggered during avatar speech with transcripts
    avatar.current.on(StreamingEvents.AVATAR_TALKING_MESSAGE, (event) => {
      if (event.detail?.message) {
        messageBuffer.current += event.detail.message;
        
        // Process complete sentences
        const sentences = messageBuffer.current.match(/[^.!?]+[.!?]+/g);
        if (sentences) {
          sentences.forEach(sentence => {
            setMessages(prev => [...prev, {
              text: sentence.trim(),
              sender: 'avatar'
            }]);
          });
          // Keep any incomplete sentence
          messageBuffer.current = messageBuffer.current.replace(/[^.!?]+[.!?]+/g, '');
        }
      }
    });
    
    // AVATAR_END_MESSAGE: Triggered when the avatar finishes its message
    avatar.current.on(StreamingEvents.AVATAR_END_MESSAGE, () => {
      console.log("Avatar end message, buffer:", messageBuffer.current);
      if (messageBuffer.current.trim()) {
        setMessages(prev => [...prev, {
          text: messageBuffer.current.trim(),
          sender: 'avatar'
        }]);
        messageBuffer.current = '';
      }
    });
    
    // USER_TALKING_MESSAGE: Triggered with user speech transcript
    avatar.current.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
      console.log("User talking message:", event.detail);
      if (event.detail?.message && chatMode === "voice_mode") {
        setMessages(prev => [...prev, {
          text: event.detail.message,
          sender: 'user'
        }]);
      }
    });
    
    // USER_END_MESSAGE: Triggered when the user finishes speaking
    avatar.current.on(StreamingEvents.USER_END_MESSAGE, (event) => {
      console.log("User end message:", event);
    });
  }

  // End the session according to API reference
  async function endSession() {
    try {
      if (avatar.current) {
        // First try to properly close voice chat if active
        if (chatMode === "voice_mode") {
          try {
            await (avatar.current as any).closeVoiceChat();
          } catch (error) {
            console.error("Error closing voice chat:", error);
          }
        }
        
        // Then stop the avatar properly
        await (avatar.current as any).stopAvatar();
        avatar.current = null;
      }
      
      // Reset UI state
      setStream(null);
      setMessages([]);
      setChatMode("text_mode");
      setText("");
      setIsUserTalking(false);
      messageBuffer.current = '';
      
    } catch (error) {
      console.error("Error ending session:", error);
      setDebug(`End session error: ${error instanceof Error ? error.message : String(error)}`);
      
      // Force cleanup even on error
      avatar.current = null;
      setStream(null);
    }
  }

  // Send message to avatar
  async function handleSpeak() {
    if (!text.trim() || !avatar.current) return;
    
    setIsLoadingRepeat(true);
    
    try {
      // Add user message to chat
      const userMessage = text.trim();
      setMessages(prev => [...prev, {
        text: userMessage,
        sender: 'user'
      }]);
      
      // Clear input
      setText("");
      
      // Use type assertion to bypass type checking for the SDK API call
      await (avatar.current as any).speak({ 
        text: userMessage, 
        taskType: TaskType.TALK,
        taskMode: TaskMode.SYNC 
      });
    } catch (error) {
      console.error("Error speaking:", error);
      setDebug(`Speak error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoadingRepeat(false);
    }
  }

  // Change chat mode between text and voice
  const handleChangeChatMode = useMemoizedFn(async (mode) => {
    if (mode === chatMode || !avatar.current) {
      return;
    }
    
    try {
      if (mode === "text_mode") {
        // Close voice chat according to API reference
        await (avatar.current as any).closeVoiceChat();
        setIsUserTalking(false);
      } else {
        setText('');
        // Start voice chat with explicit configuration from API reference
        await (avatar.current as any).startVoiceChat({
          useSilencePrompt: false,  // Don't prompt user during silence periods
          isInputAudioMuted: false  // Allow microphone input
        });
      }
      setChatMode(mode);
    } catch (error) {
      console.error("Error changing chat mode:", error);
      setDebug(`Chat mode error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Handle key press in text input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSpeak();
    }
  };

  // Show toast when trying to interact without starting
  const handleDisabledClick = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  // Setup video stream when ready
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current?.play().catch(error => {
          console.error("Error playing video:", error);
        });
      };
    }
  }, [stream]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (avatar.current) {
        avatar.current.stopAvatar();
        avatar.current = null;
      }
      
      if (audioTrackRef.current) {
        audioTrackRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Video container */}
      <div className="absolute inset-0 w-full h-full bg-gray-100">
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
          <div className="w-full h-full flex items-center justify-center">
            <img 
              src="https://cdn.shopify.com/s/files/1/0524/8794/6424/files/preview_target.webp?v=1740493527"
              alt="Digital Assistant Preview"
              className="w-full h-full object-cover"
            />
          </div>
        )}
      </div>

      {/* Interface elements */}
      <div className="absolute inset-0 flex flex-col">
        {/* End session button */}
        {stream && (
          <div className="absolute top-6 right-6 z-10">
            <button
              onClick={endSession}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-black/20 hover:bg-amber-500 text-white transition-colors group relative"
            >
              <X size={18} />
              <span className="absolute right-full mr-2 whitespace-nowrap bg-black/75 text-white px-3 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                Beëindig gesprek
              </span>
            </button>
          </div>
        )}

        {/* Loading indicator */}
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

        {/* Start button */}
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

        {/* Chat messages */}
        <div className="mt-auto centered-container">
          <div className="space-y-4 p-6">
            {stream && messages.length > 0 && (
              <ChatMessages 
                messages={messages} 
                onClear={() => setMessages([])} 
              />
            )}
            
            {/* Mode selection */}
            {stream && (
              <div className="absolute bottom-24 left-4 flex gap-2">
                <Button
                  className={`flex items-center justify-center gap-2 h-12 transition-all ${
                    chatMode === "text_mode" 
                      ? "bg-amber-500 text-white w-32"
                      : "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm w-12"
                  }`}
                  onClick={() => handleChangeChatMode("text_mode")}
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
                      ? "bg-amber-500 text-white w-32"
                      : "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm w-12"
                  }`}
                  onClick={() => handleChangeChatMode("voice_mode")}
                >
                  <Mic size={22} />
                  {chatMode === "voice_mode" && <span>Spreken</span>}
                </Button>
              </div>
            )}
            
            {/* Text input */}
            {stream && (
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
                      disabled={chatMode === "voice_mode"}
                    />
                    
                    {text && (
                      <div 
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        style={{ zIndex: 50 }}
                      >
                        <button
                          onClick={handleSpeak}
                          disabled={isLoadingRepeat || !text.trim()}
                          className="w-12 h-12 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 transition-colors"
                        >
                          {isLoadingRepeat ? (
                            <Spinner size="sm" color="white" />
                          ) : (
                            <Send size={20} className="text-white" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Voice indicator */}
                  {stream && (
                    <button
                      onClick={() => handleChangeChatMode(chatMode === "voice_mode" ? "text_mode" : "voice_mode")}
                      className={`p-3 rounded-full transition-colors shadow-lg ${
                        chatMode === "voice_mode" 
                          ? "bg-amber-500 hover:bg-amber-600" 
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
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Debug info */}
      {debug && (
        <div className="absolute bottom-28 left-4 right-4 bg-red-100 border border-red-300 text-red-800 p-2 rounded text-sm">
          <strong>Debug:</strong> {debug}
        </div>
      )}

      {/* Toast notification */}
      {showToast && (
        <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 bg-black/75 text-white px-3 py-1 rounded text-sm transition-opacity">
          Start eerst een gesprek
        </div>
      )}
    </div>
  );
}
