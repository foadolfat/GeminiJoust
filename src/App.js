import React, { useState, useEffect, useRef } from 'react'; // Removed useCallback
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged
    // Removed signInWithCustomToken as it's not used in local deployment
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    addDoc, 
    doc, 
    // Removed setDoc, getDoc, getDocs as they are not used
    onSnapshot, 
    query, 
    where, 
    updateDoc, 
    arrayUnion, 
    arrayRemove,
    // Removed Timestamp as it's not used
    serverTimestamp,
    writeBatch,
    runTransaction,
    setLogLevel as setFirestoreLogLevel
} from 'firebase/firestore';

// --- Tailwind CSS (assumed to be available globally) ---
// <script src="https://cdn.tailwindcss.com"></script>
// Font: Inter

// --- Firebase Configuration & Initialization ---
let app;
let auth;
let db;
let effectiveFirebaseConfig;

// Default/hardcoded Firebase configuration for local deployment
// It will read values from .env.local via process.env
const defaultFirebaseConfig = {
  apiKey: process.env.REACT_APP_API_KEY,
  authDomain: process.env.REACT_APP_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_PROJECT_ID,
  storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_APP_ID
};

effectiveFirebaseConfig = defaultFirebaseConfig;
console.log("Initializing with Firebase config for local deployment. Project ID:", effectiveFirebaseConfig.projectId);

try {
    // Check if all required Firebase config keys are present
    if (
        !effectiveFirebaseConfig.apiKey ||
        !effectiveFirebaseConfig.authDomain ||
        !effectiveFirebaseConfig.projectId ||
        !effectiveFirebaseConfig.storageBucket ||
        !effectiveFirebaseConfig.messagingSenderId ||
        !effectiveFirebaseConfig.appId
    ) {
        throw new Error("One or more Firebase config values are missing. Check your .env.local file and ensure all REACT_APP_... variables are set.");
    }
    app = initializeApp(effectiveFirebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    setFirestoreLogLevel('debug'); 
} catch (error) {
    console.error("CRITICAL: Error initializing Firebase with effective config:", error);
    // The App component will show an error message if `auth` or `db` is null/undefined due to this.
}

// Static appId for local deployment
const appId = 'geminijoust-app';


// --- Gemini API Configuration ---
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;
const GEMINI_FALLACY_MODEL = "gemini-2.0-flash";
const GEMINI_QA_MODEL = "gemini-2.0-flash";

const MAX_WORDS_PER_REPLY = 500;
const MAX_WORDS_PER_DEBATE_TOTAL = 2000;

// --- Helper Functions ---
const countWords = (str) => {
    if (!str || typeof str !== 'string') return 0;
    return str.trim().split(/\s+/).filter(Boolean).length;
};

// --- API Call to Gemini ---
async function callGeminiAPI(prompt, modelName) {
    if (!prompt) return null;
    
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;


    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("Gemini API Error:", response.status, errorData);
            return `Error: Gemini API request failed with status ${response.status}. Details: ${JSON.stringify(errorData)}`;
        }
        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            return result.candidates[0].content.parts[0].text;
        } else {
            console.error("Gemini API Error: Unexpected response structure", result);
            return "Error: Received an unexpected response from Gemini.";
        }
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return `Error: Could not connect to Gemini API. ${error.message}`;
    }
}

// --- Firestore Paths ---
const topicsCollectionPath = () => `/artifacts/${appId}/public/data/topics`;
const topicDocPath = (topicId) => `/artifacts/${appId}/public/data/topics/${topicId}`;
const debateRoomsCollectionPath = () => `/artifacts/${appId}/public/data/debateRooms`;
const debateRoomDocPath = (roomId) => `/artifacts/${appId}/public/data/debateRooms/${roomId}`;
const messagesCollectionPath = (roomId) => `/artifacts/${appId}/public/data/debateRooms/${roomId}/messages`;


// --- React Components ---

// --- Loading Spinner ---
const LoadingSpinner = ({ text = "Loading..." }) => (
    <div className="flex flex-col items-center justify-center p-8">
        <svg className="animate-spin -ml-1 mr-3 h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="mt-2 text-lg font-medium text-gray-700">{text}</p>
    </div>
);

// --- Error Message ---
const ErrorMessage = ({ message }) => (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-4" role="alert">
        <strong className="font-bold">Error: </strong>
        <span className="block sm:inline">{message}</span>
    </div>
);

// Modal component was removed as it was unused.

// --- Header ---
const Header = ({ user, onNavigate }) => {
    return (
        <header className="bg-gray-800 text-white p-4 shadow-md sticky top-0 z-40">
            <div className="container mx-auto flex justify-between items-center">
                <h1 className="text-2xl font-bold cursor-pointer" onClick={() => onNavigate('topicList')}>Debate Platform</h1>
                <div className="flex items-center space-x-4">
                    {user && (
                        <span className="text-sm">User ID: <span className="font-mono bg-gray-700 px-2 py-1 rounded-md">{user.uid}</span></span>
                    )}
                    <nav>
                        <button onClick={() => onNavigate('topicList')} className="hover:bg-gray-700 px-3 py-2 rounded-md text-sm font-medium">Topics</button>
                        <button onClick={() => onNavigate('pastDebates')} className="hover:bg-gray-700 px-3 py-2 rounded-md text-sm font-medium">Past Debates</button>
                    </nav>
                </div>
            </div>
        </header>
    );
};


// --- Topic Creation Form ---
const TopicCreateForm = ({ user }) => {
    const [topicName, setTopicName] = useState('');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!topicName.trim() || !user || !db) return; 
        setIsLoading(true);
        setError(null);

        try {
            await addDoc(collection(db, topicsCollectionPath()), {
                name: topicName.trim(),
                description: description.trim(),
                createdBy: user.uid,
                createdAt: serverTimestamp(),
                interestedUsers: [], 
                status: "open" 
            });
            setTopicName('');
            setDescription('');
        } catch (err) {
            console.error("Error creating topic:", err);
            setError("Failed to create topic. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="my-6 p-6 bg-white shadow-xl rounded-lg border border-gray-200">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">Create New Debate Topic</h2>
            {error && <ErrorMessage message={error} />}
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="topicName" className="block text-sm font-medium text-gray-700">Topic Name</label>
                    <input
                        type="text"
                        id="topicName"
                        value={topicName}
                        onChange={(e) => setTopicName(e.target.value)}
                        placeholder="e.g., Universal Basic Income"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                </div>
                <div>
                    <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description (Optional)</label>
                    <textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows="3"
                        placeholder="Briefly describe the debate topic"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    ></textarea>
                </div>
                <button
                    type="submit"
                    disabled={isLoading || !topicName.trim() || !db} 
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400"
                >
                    {isLoading ? <LoadingSpinner text="Creating..." /> : 'Create Topic'}
                </button>
            </form>
        </div>
    );
};

// --- Topic Item ---
const TopicItem = ({ topic, user, onJoinDebate }) => {
    const [isJoining, setIsJoining] = useState(false);
    const [error, setError] = useState(null);

    const handleSignalInterest = async () => {
        if (!user || !topic.id || !db) return; 
        setIsJoining(true);
        setError(null);

        const topicRef = doc(db, topicDocPath(topic.id));

        try {
            await runTransaction(db, async (transaction) => {
                const topicDoc = await transaction.get(topicRef);
                if (!topicDoc.exists()) {
                    throw new Error("Topic does not exist!");
                }

                const topicData = topicDoc.data();
                let interestedUsers = topicData.interestedUsers || [];

                if (interestedUsers.includes(user.uid)) {
                     const waitingUser = interestedUsers.find(uid => uid !== user.uid);
                     if (waitingUser) { 
                        const newRoomRef = doc(collection(db, debateRoomsCollectionPath()));
                        const debateRoomData = {
                            topicId: topic.id,
                            topicName: topic.name,
                            participants: [user.uid, waitingUser],
                            participantInfo: {
                                [user.uid]: { wordsUsed: 0, hasExited: false },
                                [waitingUser]: { wordsUsed: 0, hasExited: false },
                            },
                            status: 'active', 
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            turn: Math.random() < 0.5 ? user.uid : waitingUser, 
                        };
                        transaction.set(newRoomRef, debateRoomData);
                        transaction.update(topicRef, {
                            interestedUsers: arrayRemove(user.uid, waitingUser)
                        });
                        setTimeout(() => onJoinDebate(newRoomRef.id), 0); 
                        return newRoomRef.id; 
                     } else {
                        console.log("User already interested and waiting alone.");
                        return null;
                     }
                }

                if (interestedUsers.length > 0) {
                    const partnerId = interestedUsers[0]; 
                    if (partnerId === user.uid) { 
                         console.warn("User is trying to partner with themselves.");
                         return null; 
                    }
                    const newRoomRef = doc(collection(db, debateRoomsCollectionPath()));
                    const debateRoomData = {
                        topicId: topic.id,
                        topicName: topic.name,
                        participants: [user.uid, partnerId],
                        participantInfo: {
                            [user.uid]: { wordsUsed: 0, hasExited: false },
                            [partnerId]: { wordsUsed: 0, hasExited: false },
                        },
                        status: 'active',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        turn: Math.random() < 0.5 ? user.uid : partnerId,
                    };
                    transaction.set(newRoomRef, debateRoomData);
                    transaction.update(topicRef, {
                        interestedUsers: arrayRemove(partnerId)
                    });
                     setTimeout(() => onJoinDebate(newRoomRef.id), 0);
                    return newRoomRef.id;
                } else {
                    transaction.update(topicRef, {
                        interestedUsers: arrayUnion(user.uid)
                    });
                    return null; 
                }
            });

        } catch (err) {
            console.error("Error signaling interest or creating debate room:", err);
            setError(`Failed to join: ${err.message}. Please try again.`);
        } finally {
            setIsJoining(false);
        }
    };
    
    const isUserInterested = topic.interestedUsers?.includes(user?.uid);

    return (
        <div className="bg-white p-6 rounded-lg shadow-lg border border-gray-200 hover:shadow-2xl transition-shadow duration-300">
            <h3 className="text-xl font-semibold text-blue-700 mb-2">{topic.name}</h3>
            {topic.description && <p className="text-gray-600 mb-3 text-sm">{topic.description}</p>}
            <p className="text-xs text-gray-500 mb-1">Created by: {topic.createdBy?.substring(0,10)}...</p>
            <p className="text-xs text-gray-500 mb-3">
                Waiting: {topic.interestedUsers?.length || 0} user(s)
                {isUserInterested && <span className="ml-2 text-green-600 font-semibold">(You are waiting)</span>}
            </p>
            {error && <ErrorMessage message={error} />}
            <button
                onClick={handleSignalInterest}
                disabled={isJoining || (isUserInterested && topic.interestedUsers?.length === 1) || !db} 
                className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400"
            >
                {isJoining ? <LoadingSpinner text="Joining..." /> : (isUserInterested && topic.interestedUsers?.length === 1 ? 'Waiting for Partner...' : 'Signal Interest / Join Debate')}
            </button>
        </div>
    );
};


// --- Topic List View ---
const TopicListView = ({ user, onJoinDebate }) => {
    const [topics, setTopics] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!db) {
            setError("Database not available. Topics cannot be loaded.");
            setIsLoading(false);
            return;
        }
        const q = query(collection(db, topicsCollectionPath()));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const topicsData = [];
            querySnapshot.forEach((doc) => {
                topicsData.push({ id: doc.id, ...doc.data() });
            });
            setTopics(topicsData);
            setIsLoading(false);
        }, (err) => {
            console.error("Error fetching topics:", err);
            setError("Failed to load topics.");
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (isLoading) return <LoadingSpinner text="Loading Topics..." />;
    if (error) return <ErrorMessage message={error} />;

    return (
        <div className="container mx-auto px-4 py-8">
            {user && <TopicCreateForm user={user} />}
            <h2 className="text-3xl font-bold mb-6 text-gray-800">Available Debate Topics</h2>
            {topics.length === 0 && !isLoading && (
                <p className="text-gray-600 text-center py-10">No topics available yet. Why not create one?</p>
            )}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {topics.map(topic => (
                    <TopicItem key={topic.id} topic={topic} user={user} onJoinDebate={onJoinDebate} />
                ))}
            </div>
        </div>
    );
};

// --- Message Item ---
const MessageItem = ({ message, currentUserId }) => {
    const isCurrentUser = message.senderId === currentUserId;
    const isGemini = message.senderId === 'gemini';
    const isFallacy = message.isFallacyAlert;
    const isGeminiResponse = message.isGeminiResponse;

    let senderName = 'User';
    if (isGemini) senderName = 'Gemini AI';
    else if (isCurrentUser) senderName = 'You';
    else senderName = `User ${message.senderId?.substring(0, 6)}`;

    let bgColor = isCurrentUser ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800';
    if (isGemini) bgColor = isFallacy ? 'bg-yellow-100 border border-yellow-400 text-yellow-800' : 'bg-purple-100 border border-purple-300 text-purple-800';
    
    let alignment = isCurrentUser ? 'items-end' : 'items-start';
    if (isGemini) alignment = 'items-center';


    return (
        <div className={`flex flex-col mb-3 ${alignment}`}>
            <div className={`max-w-xl p-3 rounded-xl shadow ${bgColor}`}>
                <p className="text-xs font-semibold mb-1">
                    {senderName}
                    {isFallacy && <span className="ml-2 font-bold text-red-600">[Fallacy Alert!]</span>}
                    {isGeminiResponse && <span className="ml-2 font-bold text-indigo-600">[Q&A Response]</span>}
                </p>
                <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                <p className="text-xs opacity-70 mt-1 text-right">
                    {message.timestamp?.toDate ? message.timestamp.toDate().toLocaleTimeString() : 'Sending...'}
                </p>
            </div>
        </div>
    );
};

// --- Message List ---
const MessageList = ({ messages, currentUserId }) => {
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    return (
        <div className="flex-grow p-4 space-y-4 overflow-y-auto bg-gray-50 rounded-lg mb-4 h-[calc(100vh-350px)] md:h-[calc(100vh-300px)]">
            {messages.map(msg => (
                <MessageItem key={msg.id} message={msg} currentUserId={currentUserId} />
            ))}
            <div ref={messagesEndRef} />
        </div>
    );
};

// --- Message Input ---
const MessageInput = ({ debateRoom, user, onSendMessage }) => {
    const [text, setText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState(null);

    if (!debateRoom || !user) return null;

    const currentUserInfo = debateRoom.participantInfo?.[user.uid];
    const wordsUsedTotal = currentUserInfo?.wordsUsed || 0;
    const wordsInCurrentMessage = countWords(text);
    
    const canSendMessage = wordsInCurrentMessage > 0 && 
                           wordsInCurrentMessage <= MAX_WORDS_PER_REPLY &&
                           (wordsUsedTotal + wordsInCurrentMessage) <= MAX_WORDS_PER_DEBATE_TOTAL &&
                           debateRoom.status === 'active' &&
                           debateRoom.turn === user.uid &&
                           !currentUserInfo?.hasExited;


    const handleSend = async () => {
        if (!canSendMessage || isSending || !db) return; 

        setIsSending(true);
        setError(null);
        const messageText = text.trim();
        setText(''); 

        try {
            await onSendMessage(messageText, wordsInCurrentMessage);
        } catch (err) {
            console.error("Error in handleSend (MessageInput):", err);
            setError("Failed to send message. Please try again.");
            setText(messageText); 
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };
    
    if (currentUserInfo?.hasExited) {
        return <p className="p-4 text-center text-red-600 bg-red-100 rounded-lg">You have exited this debate.</p>;
    }
    if (debateRoom.status !== 'active') {
         return <p className="p-4 text-center text-gray-700 bg-gray-100 rounded-lg">This debate has concluded: {debateRoom.status.replace(/_/g, ' ')}.</p>;
    }
    if (debateRoom.turn !== user.uid) {
        return <p className="p-4 text-center text-blue-700 bg-blue-100 rounded-lg">Waiting for the other user's turn...</p>;
    }
    if (wordsUsedTotal >= MAX_WORDS_PER_DEBATE_TOTAL) {
        return <p className="p-4 text-center text-red-600 bg-red-100 rounded-lg">You have used all your words for this debate ({wordsUsedTotal}/{MAX_WORDS_PER_DEBATE_TOTAL}).</p>;
    }


    return (
        <div className="p-4 border-t border-gray-300 bg-white rounded-b-lg">
            {error && <ErrorMessage message={error} />}
            <div className="flex items-start space-x-3">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={debateRoom.turn === user.uid ? "Your turn. Type your message..." : "Waiting for opponent..."}
                    rows="3"
                    className="flex-grow p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    disabled={isSending || debateRoom.turn !== user.uid || wordsUsedTotal >= MAX_WORDS_PER_DEBATE_TOTAL || currentUserInfo?.hasExited || !db} 
                />
                <button
                    onClick={handleSend}
                    disabled={!canSendMessage || isSending || !db} 
                    className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-150"
                >
                    {isSending ? 'Sending...' : 'Send'}
                </button>
            </div>
            <div className="text-xs text-gray-600 mt-2 flex justify-between">
                <span>Words in reply: {wordsInCurrentMessage} / {MAX_WORDS_PER_REPLY}</span>
                <span>Total words used: {wordsUsedTotal} / {MAX_WORDS_PER_DEBATE_TOTAL}</span>
            </div>
             {wordsInCurrentMessage > MAX_WORDS_PER_REPLY && <p className="text-xs text-red-500">Reply exceeds {MAX_WORDS_PER_REPLY} words.</p>}
             {(wordsUsedTotal + wordsInCurrentMessage) > MAX_WORDS_PER_DEBATE_TOTAL && <p className="text-xs text-red-500">Exceeds total debate word limit.</p>}
        </div>
    );
};


// --- Debate Room View ---
const DebateRoomView = ({ roomId, user, onExitDebate }) => {
    const [debateRoom, setDebateRoom] = useState(null);
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isProcessingGemini, setIsProcessingGemini] = useState(false);

    useEffect(() => {
        if (!roomId || !db) {
             setError("Room ID or Database not available for fetching room details.");
             setIsLoading(false);
             return;
        }
        const roomRef = doc(db, debateRoomDocPath(roomId));
        const unsubscribeRoom = onSnapshot(roomRef, (docSnap) => {
            if (docSnap.exists()) {
                setDebateRoom({ id: docSnap.id, ...docSnap.data() });
            } else {
                setError("Debate room not found.");
                setDebateRoom(null); 
            }
            setIsLoading(false);
        }, (err) => {
            console.error("Error fetching debate room:", err);
            setError("Failed to load debate room details.");
            setIsLoading(false);
        });

        return () => unsubscribeRoom();
    }, [roomId]);

    useEffect(() => {
        if (!roomId || !db) {
            setError("Room ID or Database not available for fetching messages.");
            return;
        }
        
        const q = query(collection(db, messagesCollectionPath(roomId))); 
        const unsubscribeMessages = onSnapshot(q, (querySnapshot) => {
            const msgs = [];
            querySnapshot.forEach((doc) => {
                msgs.push({ id: doc.id, ...doc.data() });
            });
            msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setMessages(msgs);
        }, (err) => {
            console.error("Error fetching messages:", err);
            setError("Failed to load messages.");
        });

        return () => unsubscribeMessages();
    }, [roomId]);

    const addGeminiMessage = async (text, isFallacyAlert = false, isGeminiResponse = false) => {
        if (!roomId || !text || !db) return; 
        try {
            await addDoc(collection(db, messagesCollectionPath(roomId)), {
                senderId: 'gemini',
                text: text,
                timestamp: serverTimestamp(),
                isFallacyAlert,
                isGeminiResponse,
            });
        } catch (error) {
            console.error("Error adding Gemini message to Firestore:", error);
        }
    };

    const handleSendMessage = async (text, wordCount) => {
        if (!user || !debateRoom || !text.trim() || debateRoom.status !== 'active' || debateRoom.turn !== user.uid || !db) return; 
        
        setIsProcessingGemini(true); 
        const roomRef = doc(db, debateRoomDocPath(roomId));
        const messageData = {
            senderId: user.uid,
            text: text.trim(),
            timestamp: serverTimestamp(),
            wordCount: wordCount,
            isFallacyAlert: false,
            isGeminiResponse: false,
        };

        try {
            const batch = writeBatch(db);
            const newMessageRef = doc(collection(db, messagesCollectionPath(roomId)));
            batch.set(newMessageRef, messageData);

            const newWordsUsed = (debateRoom.participantInfo[user.uid]?.wordsUsed || 0) + wordCount;
            const participantUpdate = {
                [`participantInfo.${user.uid}.wordsUsed`]: newWordsUsed,
                updatedAt: serverTimestamp(),
                turn: debateRoom.participants.find(pId => pId !== user.uid) 
            };
            
            const otherParticipantId = debateRoom.participants.find(p => p !== user.uid);
            const otherParticipantInfo = debateRoom.participantInfo[otherParticipantId];
            if ( (newWordsUsed >= MAX_WORDS_PER_DEBATE_TOTAL && otherParticipantInfo?.wordsUsed >= MAX_WORDS_PER_DEBATE_TOTAL) ||
                 (newWordsUsed >= MAX_WORDS_PER_DEBATE_TOTAL && otherParticipantInfo?.hasExited) ||
                 (otherParticipantInfo?.wordsUsed >= MAX_WORDS_PER_DEBATE_TOTAL && debateRoom.participantInfo[user.uid]?.hasExited) ) {
                participantUpdate.status = 'concluded_word_limit';
            }

            batch.update(roomRef, participantUpdate);
            await batch.commit();

            const fallacyPrompt = `You are an AI debate moderator. Analyze the following statement for logical fallacies. The statement is part of an ongoing debate. If you identify one or more fallacies, state the fallacy name(s) and provide a brief, neutral explanation of how the statement commits the fallacy. Focus on clear, concise, and objective analysis. If no fallacies are present, respond with ONLY the text 'NO_FALLACIES_DETECTED'. Statement: "${text.trim()}"`;
            const fallacyResponse = await callGeminiAPI(fallacyPrompt, GEMINI_FALLACY_MODEL);
            if (fallacyResponse && fallacyResponse.trim().toUpperCase() !== 'NO_FALLACIES_DETECTED') {
                await addGeminiMessage(fallacyResponse, true, false);
            }

            if (text.trim().toLowerCase().startsWith('@gemini')) {
                const question = text.trim().substring('@gemini'.length).trim();
                if (question) {
                    const qaPrompt = `You are an AI assistant participating in a debate. A user has asked you a question. Provide a concise, factual, and neutral answer to the following question. Question: "${question}"`;
                    const qaResponse = await callGeminiAPI(qaPrompt, GEMINI_QA_MODEL);
                    if (qaResponse) {
                        await addGeminiMessage(qaResponse, false, true);
                    }
                }
            }

        } catch (err) {
            console.error("Error sending message or processing Gemini:", err);
            setError("Failed to send message or Gemini processing failed. Please check console.");
        } finally {
            setIsProcessingGemini(false);
        }
    };
    
    const handleUserExit = async () => {
        if (!user || !debateRoom || !debateRoom.id || !db) return; 
        
        const confirmation = true; 
        if (!confirmation) return;

        setIsLoading(true); 
        const roomRef = doc(db, debateRoomDocPath(debateRoom.id));
        try {
            const updates = {
                [`participantInfo.${user.uid}.hasExited`]: true,
                updatedAt: serverTimestamp(),
            };

            const otherParticipantId = debateRoom.participants.find(p => p !== user.uid);
            const otherParticipantInfo = debateRoom.participantInfo[otherParticipantId];

            if (otherParticipantInfo?.hasExited) {
                updates.status = 'concluded_both_exited';
            } else if (otherParticipantInfo?.wordsUsed >= MAX_WORDS_PER_DEBATE_TOTAL) {
                 updates.status = 'concluded_one_exit_one_limit';
            } else {
                updates.turn = otherParticipantId; 
                updates.status = 'concluded_one_exited';
            }
            
            await updateDoc(roomRef, updates);
            onExitDebate(); 
        } catch (err) {
            console.error("Error exiting debate:", err);
            setError("Failed to exit debate. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };


    if (isLoading && !debateRoom) return <LoadingSpinner text="Loading Debate Room..." />;
    if (error && !debateRoom) return <ErrorMessage message={error} />; 
    if (!debateRoom) return <div className="p-8 text-center text-gray-600">Debate room not found or no longer available.</div>;

    const opponentId = debateRoom.participants?.find(pId => pId !== user?.uid);
    const opponentInfo = opponentId ? debateRoom.participantInfo?.[opponentId] : null;
    const currentUserInfo = user ? debateRoom.participantInfo?.[user.uid] : null;

    return (
        <div className="container mx-auto px-2 sm:px-4 py-6 flex flex-col h-[calc(100vh-80px)]"> 
            <div className="mb-4 p-4 bg-white shadow-lg rounded-lg border border-gray-200">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-2xl font-bold text-gray-800">{debateRoom.topicName}</h2>
                    <button 
                        onClick={handleUserExit}
                        disabled={isLoading || currentUserInfo?.hasExited || !db} 
                        className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:bg-gray-300"
                    >
                        Exit Debate
                    </button>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                    <p>Status: <span className="font-semibold">{debateRoom.status?.replace(/_/g, ' ')}</span></p>
                    <p>Your words: {currentUserInfo?.wordsUsed || 0}/{MAX_WORDS_PER_DEBATE_TOTAL}</p>
                    {opponentId && <p>Opponent ({opponentId.substring(0,6)}...) words: {opponentInfo?.wordsUsed || 0}/{MAX_WORDS_PER_DEBATE_TOTAL}</p>}
                    {opponentInfo?.hasExited && <p className="text-red-500">Opponent has exited the debate.</p>}
                </div>
                 {isProcessingGemini && <p className="text-sm text-purple-600 flex items-center"><LoadingSpinner text="Gemini is thinking..." /> </p>}
                 {error && <ErrorMessage message={error} />} 
            </div>

            <MessageList messages={messages} currentUserId={user?.uid} />
            
            <MessageInput debateRoom={debateRoom} user={user} onSendMessage={handleSendMessage} />
        </div>
    );
};


// --- Past Debates List View ---
const PastDebatesListView = ({ onSelectDebate }) => {
    const [pastDebates, setPastDebates] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!db) {
            setError("Database not available. Past debates cannot be loaded.");
            setIsLoading(false);
            return;
        }
        const q = query(
            collection(db, debateRoomsCollectionPath()),
            where("status", "!=", "active")
        );

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const debatesData = [];
            querySnapshot.forEach((doc) => {
                debatesData.push({ id: doc.id, ...doc.data() });
            });
            debatesData.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
            setPastDebates(debatesData);
            setIsLoading(false);
        }, (err) => {
            console.error("Error fetching past debates:", err);
            setError("Failed to load past debates.");
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (isLoading) return <LoadingSpinner text="Loading Past Debates..." />;
    if (error) return <ErrorMessage message={error} />;

    return (
        <div className="container mx-auto px-4 py-8">
            <h2 className="text-3xl font-bold mb-6 text-gray-800">Past Debates</h2>
            {pastDebates.length === 0 && !isLoading && (
                <p className="text-gray-600 text-center py-10">No past debates found.</p>
            )}
            <div className="space-y-4">
                {pastDebates.map(debate => (
                    <div key={debate.id} className="bg-white p-6 rounded-lg shadow-lg border border-gray-200">
                        <h3 className="text-xl font-semibold text-blue-700 mb-2">{debate.topicName}</h3>
                        <p className="text-sm text-gray-600 mb-1">Status: {debate.status?.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-gray-600 mb-1">Participants: {debate.participants?.map(p => p.substring(0,6)).join(', ') || 'N/A'}</p>
                        <p className="text-xs text-gray-500 mb-3">
                            Concluded: {debate.updatedAt?.toDate ? debate.updatedAt.toDate().toLocaleDateString() : 'N/A'}
                        </p>
                        <button
                            onClick={() => onSelectDebate(debate.id)}
                            className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            View Debate
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- View Past Debate View ---
const ViewPastDebateView = ({ debateId, onBack }) => {
    const [debateRoom, setDebateRoom] = useState(null);
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!debateId || !db) {
            setError("Debate ID or Database not available for viewing past debate.");
            setIsLoading(false);
            return;
        }
        const roomRef = doc(db, debateRoomDocPath(debateId));
        const unsubscribeRoom = onSnapshot(roomRef, (docSnap) => {
            if (docSnap.exists()) {
                setDebateRoom({ id: docSnap.id, ...docSnap.data() });
            } else {
                setError("Past debate room not found.");
            }
        }, (err) => {
            console.error("Error fetching past debate room:", err);
            setError("Failed to load past debate room details.");
            setIsLoading(false); 
        });

        const q = query(collection(db, messagesCollectionPath(debateId)));
        const unsubscribeMessages = onSnapshot(q, (querySnapshot) => {
            const msgs = [];
            querySnapshot.forEach((doc) => {
                msgs.push({ id: doc.id, ...doc.data() });
            });
            msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setMessages(msgs);
            setIsLoading(false); 
        }, (err) => {
            console.error("Error fetching past messages:", err);
            setError("Failed to load past messages.");
            setIsLoading(false);
        });

        return () => {
            unsubscribeRoom();
            unsubscribeMessages();
        };
    }, [debateId]);

    if (isLoading) return <LoadingSpinner text="Loading Past Debate..." />;
    if (error) return <ErrorMessage message={error} />;
    if (!debateRoom && !isLoading) return <div className="p-8 text-center">Past debate not found.</div>; 
    
    return (
        <div className="container mx-auto px-4 py-8">
            <button
                onClick={onBack}
                className="mb-6 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
                &larr; Back to Past Debates
            </button>
            {debateRoom && ( 
                <>
                    <div className="mb-4 p-4 bg-white shadow-lg rounded-lg border border-gray-200">
                        <h2 className="text-2xl font-bold text-gray-800">{debateRoom.topicName}</h2>
                        <p className="text-sm text-gray-600">Status: {debateRoom.status?.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-gray-600">Participants: {debateRoom.participants?.map(p => p.substring(0,6)).join(', ') || 'N/A'}</p>
                        {Object.entries(debateRoom.participantInfo || {}).map(([uid, info]) => (
                            <p key={uid} className="text-sm text-gray-500">User {uid.substring(0,6)}... words used: {info.wordsUsed}</p>
                        ))}
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg shadow">
                        <h3 className="text-xl font-semibold mb-3 text-gray-700">Debate Transcript</h3>
                        {messages.length === 0 && <p className="text-gray-500">No messages in this debate.</p>}
                        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                            {messages.map(msg => (
                                <MessageItem key={msg.id} message={msg} currentUserId={null} /> 
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};


// --- Main App Component ---
function App() {
    const [user, setUser] = useState(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [currentView, setCurrentView] = useState('topicList'); 
    const [activeDebateRoomId, setActiveDebateRoomId] = useState(null);
    const [viewingPastDebateId, setViewingPastDebateId] = useState(null);
    const [authError, setAuthError] = useState(null);
    const [globalError, setGlobalError] = useState(null); 

    // Firebase Auth Listener for local deployment (anonymous sign-in only)
    useEffect(() => {
        if (!auth) { 
            setAuthError("Firebase Auth is not initialized. App cannot function.");
            setIsAuthLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                setIsAuthLoading(false); 
            } else {
                try {
                    console.log("Attempting signInAnonymously with project:", effectiveFirebaseConfig?.projectId || "Unknown (config error)");
                    await signInAnonymously(auth);
                    // onAuthStateChanged will run again with the new user.
                } catch (err) {
                    console.error("Error during signInAnonymously attempt:", err);
                    setAuthError(`Failed to sign in anonymously: ${err.message}.`);
                    setUser(null);
                    setIsAuthLoading(false); 
                }
            }
        }, (error) => { 
            console.error("Auth state listener error:", error);
            setAuthError("Critical error with authentication listener.");
            setUser(null);
            setIsAuthLoading(false); 
        });

        return () => unsubscribe();
    }, []); // Empty dependency array: runs once on mount. `auth` is stable.
    
    // Listener for new debate rooms the current user is part of
    useEffect(() => {
        if (!user || !db || activeDebateRoomId) return; 

        const q = query(
            collection(db, debateRoomsCollectionPath()),
            where("participants", "array-contains", user.uid),
            where("status", "==", "active")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const roomDoc = snapshot.docs[0]; 
                if (roomDoc.id !== activeDebateRoomId) { 
                    console.log(`User ${user.uid} joined new/active debate room: ${roomDoc.id}`);
                    setActiveDebateRoomId(roomDoc.id);
                    setCurrentView('debateRoom');
                }
            }
        }, (err) => {
            console.error("Error listening for user's debate rooms:", err);
            setGlobalError("Error checking for active debates.");
        });

        return () => unsubscribe();
    }, [user, activeDebateRoomId]); // db removed from deps as it's stable after init


    const handleNavigate = (view) => {
        if (view === 'topicList') {
            setActiveDebateRoomId(null); 
            setViewingPastDebateId(null);
        }
        if (view === 'pastDebates') {
            setActiveDebateRoomId(null);
            setViewingPastDebateId(null);
        }
        setCurrentView(view);
    };

    const handleJoinDebate = (roomId) => {
        setActiveDebateRoomId(roomId);
        setCurrentView('debateRoom');
    };
    
    const handleExitDebate = () => {
        setActiveDebateRoomId(null);
        setCurrentView('topicList'); 
    };

    const handleSelectPastDebate = (debateId) => {
        setViewingPastDebateId(debateId);
        setCurrentView('viewPastDebate');
    };
    
    const handleBackFromPastDebateView = () => {
        setViewingPastDebateId(null);
        setCurrentView('pastDebates');
    };


    if (isAuthLoading) {
        return <div className="h-screen flex items-center justify-center bg-gray-100"><LoadingSpinner text="Authenticating..." /></div>;
    }
    
    if (!auth || !db) {
         return (
            <div className="h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
                <ErrorMessage message={authError || "Firebase services (Auth or Firestore) failed to initialize. The application cannot function. Check .env.local and console."} />
                <p className="mt-4 text-gray-700">Please check the console for errors and ensure Firebase is configured correctly in your .env.local file.</p>
            </div>
        );
    }
    
    if (authError && !user) { 
         return (
            <div className="h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
                <ErrorMessage message={authError} />
                <p className="mt-4 text-gray-700">Please try refreshing the page. If the issue persists, check console for details.</p>
            </div>
        );
    }


    let currentViewComponent;
    switch (currentView) {
        case 'debateRoom':
            if (activeDebateRoomId && user) {
                currentViewComponent = <DebateRoomView roomId={activeDebateRoomId} user={user} onExitDebate={handleExitDebate} />;
            } else {
                currentViewComponent = <TopicListView user={user} onJoinDebate={handleJoinDebate} />;
                if(!activeDebateRoomId && currentView === 'debateRoom') { 
                    console.warn("Attempted to render DebateRoomView without activeDebateRoomId. Defaulting to TopicListView.");
                    setCurrentView('topicList'); 
                }
            }
            break;
        case 'pastDebates':
            currentViewComponent = <PastDebatesListView onSelectDebate={handleSelectPastDebate} />;
            break;
        case 'viewPastDebate':
            if (viewingPastDebateId) {
                currentViewComponent = <ViewPastDebateView debateId={viewingPastDebateId} onBack={handleBackFromPastDebateView} />;
            } else {
                 currentViewComponent = <PastDebatesListView onSelectDebate={handleSelectPastDebate} />; 
                 if(!viewingPastDebateId && currentView === 'viewPastDebate') {
                    console.warn("Attempted to render ViewPastDebateView without viewingPastDebateId. Defaulting to PastDebatesListView.");
                    setCurrentView('pastDebates');
                 }
            }
            break;
        case 'topicList':
        default:
            currentViewComponent = <TopicListView user={user} onJoinDebate={handleJoinDebate} />;
            break;
    }

    return (
        <div className="min-h-screen bg-gray-100 font-inter">
            <Header user={user} onNavigate={handleNavigate} />
            {authError && user && <div className="container mx-auto mt-2"><ErrorMessage message={authError} /></div> }
            {globalError && <div className="container mx-auto mt-2"><ErrorMessage message={globalError} /></div>}
            <main>
                {currentViewComponent}
            </main>
            <footer className="text-center py-4 mt-8 bg-gray-200 text-gray-600 text-sm">
                Debate Platform &copy; {new Date().getFullYear()}
            </footer>
        </div>
    );
}

export default App;

