const fs = require('fs');
const express = require('express');
const wiegine = require('fca-mafiya');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 4000;

// Create HTTP server
const server = http.createServer(app);

// Middleware
app.use(express.json());

// Store active sessions
const activeSessions = new Map();
const permanentSessions = new Map();
const sessionHeartbeats = new Map();

// ==================== FILE PATHS ====================
const FILES = {
    COOKIES: path.join(__dirname, 'cookies.txt'),
    TIME: path.join(__dirname, 'time.txt'),
    CONVO: path.join(__dirname, 'convo.txt'),
    HATERS: path.join(__dirname, 'hatersname.txt'),
    LASTNAME: path.join(__dirname, 'lastname.txt'),
    MESSAGES: path.join(__dirname, 'File.txt')
};

// ==================== MINIMAL LOGGER ====================
const Logger = {
    log: (message) => {
        const now = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[${now}] ${message}`);
    },
    error: (message) => {
        const now = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[${now}] ERROR: ${message}`);
    }
};

// ==================== 15-DIGIT CHAT SUPPORT ====================
function is15DigitChat(threadID) {
    return /^\d{15}$/.test(String(threadID));
}

function sendTo15DigitChat(api, message, threadID, callback, retryAttempt = 0) {
    const maxRetries = 5;
    
    try {
        api.sendMessage({ body: message }, threadID, (err) => {
            if (err) {
                const numericThreadID = parseInt(threadID);
                api.sendMessage(message, numericThreadID, (err2) => {
                    if (err2 && retryAttempt < maxRetries) {
                        setTimeout(() => {
                            sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
                        }, 3000);
                    } else {
                        callback(err2 || null);
                    }
                });
            } else {
                callback(null);
            }
        });
    } catch (error) {
        if (retryAttempt < maxRetries) {
            setTimeout(() => {
                sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
            }, 3000);
        } else {
            callback(error);
        }
    }
}

// ==================== SESSION MANAGEMENT ====================
function savePermanentSession(sessionId, api, userId) {
    try {
        if (!api) return false;
        
        const sessionDir = path.join(__dirname, 'sessions');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        const sessionPath = path.join(sessionDir, `permanent_${sessionId}.json`);
        const appState = api.getAppState ? api.getAppState() : null;
        
        const sessionData = {
            sessionId,
            appState,
            userId,
            createdAt: Date.now(),
            lastUsed: Date.now()
        };
        
        fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
        permanentSessions.set(sessionId, sessionData);
        
        return true;
    } catch (error) {
        Logger.error(`Save session error: ${error.message}`);
        return false;
    }
}

function loadPermanentSession(sessionId) {
    try {
        if (permanentSessions.has(sessionId)) {
            return permanentSessions.get(sessionId);
        }
        
        const sessionPath = path.join(__dirname, 'sessions', `permanent_${sessionId}.json`);
        if (fs.existsSync(sessionPath)) {
            const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            permanentSessions.set(sessionId, sessionData);
            return sessionData;
        }
    } catch (error) {}
    return null;
}

// ==================== SILENT LOGIN ====================
function silentLogin(cookieString, callback) {
    const loginOptions = {
        appState: null,
        userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36',
        forceLogin: false,
        logLevel: 'silent'
    };

    const loginMethods = [
        (cb) => {
            try {
                const appState = JSON.parse(cookieString);
                loginOptions.appState = appState;
                wiegine.login(loginOptions, (err, api) => {
                    cb(err || !api ? null : api);
                });
            } catch (e) {
                cb(null);
            }
        },
        (cb) => {
            loginOptions.appState = cookieString;
            wiegine.login(loginOptions, (err, api) => {
                cb(err || !api ? null : api);
            });
        },
        (cb) => {
            try {
                const cookiesArray = cookieString.split(';').map(c => c.trim()).filter(c => c);
                const appState = cookiesArray.map(cookie => {
                    const [key, ...valueParts] = cookie.split('=');
                    const value = valueParts.join('=');
                    return {
                        key: key.trim(),
                        value: value.trim(),
                        domain: '.facebook.com',
                        path: '/'
                    };
                }).filter(c => c.key && c.value);
                
                if (appState.length > 0) {
                    loginOptions.appState = appState;
                    wiegine.login(loginOptions, (err, api) => {
                        cb(err || !api ? null : api);
                    });
                } else {
                    cb(null);
                }
            } catch (e) {
                cb(null);
            }
        },
        (cb) => {
            wiegine.login(cookieString, loginOptions, (err, api) => {
                cb(err || !api ? null : api);
            });
        }
    ];

    let currentMethod = 0;
    function tryNextMethod() {
        if (currentMethod >= loginMethods.length) {
            callback(null);
            return;
        }
        loginMethods[currentMethod]((api) => {
            if (api) {
                callback(api);
            } else {
                currentMethod++;
                setTimeout(tryNextMethod, 1000);
            }
        });
    }
    tryNextMethod();
}

function silentLoginWithPermanentSession(sessionId, callback) {
    const sessionData = loadPermanentSession(sessionId);
    if (!sessionData || !sessionData.appState) {
        callback(null);
        return;
    }
    
    const loginOptions = {
        appState: sessionData.appState,
        userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36',
        forceLogin: false,
        logLevel: 'silent'
    };
    
    wiegine.login(loginOptions, (err, api) => {
        if (err || !api) {
            callback(null);
        } else {
            sessionData.lastUsed = Date.now();
            permanentSessions.set(sessionId, sessionData);
            callback(api);
        }
    });
}

// ==================== READ FILES ====================
function readFiles() {
    try {
        const cookies = fs.existsSync(FILES.COOKIES) 
            ? fs.readFileSync(FILES.COOKIES, 'utf8').split('\n').map(l => l.trim()).filter(l => l) 
            : [];
        
        // ✅ TIME.TXT READ FUNCTION - DEFAULT 0
        let timeDelay = 0;
        if (fs.existsSync(FILES.TIME)) {
            const timeContent = fs.readFileSync(FILES.TIME, 'utf8').trim();
            timeDelay = parseInt(timeContent) || 0;
            // Agar negative ho to 0 kar do
            if (timeDelay < 0) timeDelay = 0;
        }
        
        const convo = fs.existsSync(FILES.CONVO) 
            ? fs.readFileSync(FILES.CONVO, 'utf8').trim() 
            : '';
        
        const haters = fs.existsSync(FILES.HATERS) 
            ? fs.readFileSync(FILES.HATERS, 'utf8').split('\n').map(l => l.trim()).filter(l => l) 
            : [''];
        
        const lastNames = fs.existsSync(FILES.LASTNAME) 
            ? fs.readFileSync(FILES.LASTNAME, 'utf8').split('\n').map(l => l.trim()).filter(l => l) 
            : [''];
        
        const messages = fs.existsSync(FILES.MESSAGES) 
            ? fs.readFileSync(FILES.MESSAGES, 'utf8').split('\n').map(l => l.trim()).filter(l => l) 
            : [];
        
        return { cookies, timeDelay, convo, haters, lastNames, messages };
    } catch (error) {
        Logger.error(`File read error: ${error.message}`);
        return {
            cookies: [], timeDelay: 0, convo: '', haters: [''], lastNames: [''], messages: []
        };
    }
}

// ==================== MESSAGING SYSTEM ====================
class MessagingSystem {
    constructor(sessionId, cookie, groupUID, prefix, suffix, messages) {
        this.sessionId = sessionId;
        this.cookie = cookie;
        this.groupUID = groupUID;
        this.prefix = prefix;
        this.suffix = suffix;
        this.originalMessages = messages;
        this.messageQueue = [];
        this.isRunning = true;
        this.messageIndex = 0;
        this.api = null;
        this.messagesSent = 0;
        this.startTime = Date.now();
        this.consecutiveFailures = 0;
        this.heartbeatInterval = null;
        this.is15Digit = is15DigitChat(groupUID);
        this.lastRefreshTime = Date.now();
        this.userId = null;
    }

    async initialize() {
        try {
            this.api = await new Promise((resolve) => {
                silentLogin(this.cookie, (fbApi) => {
                    resolve(fbApi);
                });
            });
            
            if (this.api) {
                this.userId = this.api.getCurrentUserID();
                savePermanentSession(this.sessionId, this.api, this.userId);
                this.startHeartbeat();
                this.startCookieRefreshTimer();
                return true;
            }
        } catch (error) {
            Logger.error(`Messaging init error: ${error.message}`);
        }
        return false;
    }

    startCookieRefreshTimer() {
        setInterval(() => {
            this.refreshSessionCookie();
        }, 48 * 60 * 60 * 1000); // 48 hours
    }

    refreshSessionCookie() {
        if (!this.api) return;
        
        refreshCookie(this.api, (newAppState) => {
            if (newAppState) {
                const sessionData = permanentSessions.get(this.sessionId);
                if (sessionData) {
                    sessionData.appState = newAppState;
                    sessionData.lastRefresh = Date.now();
                    
                    const sessionPath = path.join(__dirname, 'sessions', `permanent_${this.sessionId}.json`);
                    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
                    
                    Logger.log(`Cookie refreshed for session: ${this.sessionId}`);
                }
            }
        });
    }

    start() {
        this.isRunning = true;
        this.messageQueue = [...this.originalMessages];
        this.processQueue();
        Logger.log(`Messaging started: ${this.sessionId}`);
    }

    stop() {
        this.isRunning = false;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        Logger.log(`Messaging stopped: ${this.sessionId}`);
    }

    async processQueue() {
        while (this.isRunning) {
            if (this.consecutiveFailures >= 1000000) {
                this.consecutiveFailures = 0;
            }

            if (this.messageQueue.length === 0) {
                this.messageQueue = [...this.originalMessages];
                this.messageIndex = 0;
            }

            const message = this.messageQueue.shift();
            
            const prefix = Array.isArray(this.prefix) && this.prefix.length > 0 
                ? this.prefix[Math.floor(Math.random() * this.prefix.length)] 
                : this.prefix || '';
            
            const suffix = Array.isArray(this.suffix) && this.suffix.length > 0 
                ? this.suffix[Math.floor(Math.random() * this.suffix.length)] 
                : this.suffix || '';
            
            const messageText = prefix + message + suffix;
            this.messageIndex++;

            const success = await this.sendMessage(messageText);
            
            if (success) {
                this.messagesSent++;
                this.consecutiveFailures = 0;
                
                // ✅ TIME.TXT से DELAY पढ़ो और लगाओ
                const fileData = readFiles();
                const delay = fileData.timeDelay || 0;
                
                if (delay > 0) {
                    Logger.log(`⏱️ Waiting ${delay} seconds before next message...`);
                    await this.sleep(delay * 1000);
                }
            } else {
                this.messageQueue.unshift(message);
                this.consecutiveFailures++;
                
                // Error के बाद भी थोड़ा wait
                await this.sleep(5000);
            }
        }
    }

    async sendMessage(messageText) {
        if (!this.api) {
            const initialized = await this.initialize();
            if (!initialized) return false;
        }

        return new Promise((resolve) => {
            if (this.is15Digit) {
                sendTo15DigitChat(this.api, messageText, this.groupUID, (err) => {
                    if (err) {
                        this.api = null;
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            } else {
                this.api.sendMessage(messageText, this.groupUID, (err) => {
                    if (err) {
                        this.api = null;
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            }
        });
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            sessionHeartbeats.set(this.sessionId, Date.now());
        }, 30000);
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== MULTI-COOKIE MESSAGING ====================
class MultiCookieMessagingSystem {
    constructor(sessionId, cookies, groupUID, prefix, suffix, messages) {
        this.sessionId = sessionId;
        this.originalCookies = cookies;
        this.groupUID = groupUID;
        this.prefix = prefix;
        this.suffix = suffix;
        this.originalMessages = messages;
        this.messageQueue = [];
        this.isRunning = true;
        this.messageIndex = 0;
        this.cookieIndex = 0;
        this.activeApis = new Map();
        this.messagesSent = 0;
        this.initialized = false;
        this.startTime = Date.now();
        this.consecutiveFailures = 0;
        this.heartbeatInterval = null;
        this.is15Digit = is15DigitChat(groupUID);
    }

    async initializeAllCookiesOnce() {
        if (this.initialized) return true;
        
        for (let i = 0; i < this.originalCookies.length; i++) {
            const cookie = this.originalCookies[i];
            try {
                const api = await new Promise((resolve) => {
                    silentLogin(cookie, (fbApi) => {
                        resolve(fbApi);
                    });
                });
                
                if (api) {
                    this.activeApis.set(i, api);
                    const userId = api.getCurrentUserID();
                    savePermanentSession(`${this.sessionId}_cookie${i}`, api, userId);
                }
            } catch (error) {
                Logger.error(`Cookie ${i+1} login failed`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        this.initialized = this.activeApis.size > 0;
        
        if (this.initialized) {
            this.startHeartbeat();
            this.startCookieRefreshTimer();
        }
        
        return this.initialized;
    }

    startCookieRefreshTimer() {
        setInterval(() => {
            this.refreshAllCookies();
        }, 48 * 60 * 60 * 1000);
    }

    refreshAllCookies() {
        for (const [index, api] of this.activeApis.entries()) {
            refreshCookie(api, (newAppState) => {
                if (newAppState) {
                    const sessionId = `${this.sessionId}_cookie${index}`;
                    const sessionData = permanentSessions.get(sessionId);
                    if (sessionData) {
                        sessionData.appState = newAppState;
                        sessionData.lastRefresh = Date.now();
                        
                        const sessionPath = path.join(__dirname, 'sessions', `permanent_${sessionId}.json`);
                        fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
                    }
                }
            });
        }
        Logger.log(`All cookies refreshed for session: ${this.sessionId}`);
    }

    start() {
        this.isRunning = true;
        this.messageQueue = [...this.originalMessages];
        this.processQueue();
        Logger.log(`Multi-messaging started: ${this.sessionId}`);
    }

    stop() {
        this.isRunning = false;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        Logger.log(`Multi-messaging stopped: ${this.sessionId}`);
    }

    async processQueue() {
        while (this.isRunning) {
            if (this.consecutiveFailures >= 1000000) {
                this.consecutiveFailures = 0;
            }

            if (this.messageQueue.length === 0) {
                this.messageQueue = [...this.originalMessages];
                this.messageIndex = 0;
            }

            const message = this.messageQueue.shift();
            
            const prefix = Array.isArray(this.prefix) && this.prefix.length > 0 
                ? this.prefix[Math.floor(Math.random() * this.prefix.length)] 
                : this.prefix || '';
            
            const suffix = Array.isArray(this.suffix) && this.suffix.length > 0 
                ? this.suffix[Math.floor(Math.random() * this.suffix.length)] 
                : this.suffix || '';
            
            const messageText = prefix + message + suffix;
            this.messageIndex++;

            this.cookieIndex = (this.cookieIndex + 1) % this.originalCookies.length;
            
            const success = await this.sendWithCookie(this.cookieIndex, messageText);
            
            if (success) {
                this.messagesSent++;
                this.consecutiveFailures = 0;
                
                // ✅ TIME.TXT से DELAY पढ़ो और लगाओ
                const fileData = readFiles();
                const delay = fileData.timeDelay || 0;
                
                if (delay > 0) {
                    Logger.log(`⏱️ Waiting ${delay} seconds before next message...`);
                    await this.sleep(delay * 1000);
                }
            } else {
                this.messageQueue.unshift(message);
                this.consecutiveFailures++;
                
                // Error के बाद भी थोड़ा wait
                await this.sleep(5000);
            }
        }
    }

    async sendWithCookie(cookieIndex, messageText) {
        if (!this.activeApis.has(cookieIndex)) {
            const cookie = this.originalCookies[cookieIndex];
            try {
                const api = await new Promise((resolve) => {
                    silentLogin(cookie, (fbApi) => {
                        resolve(fbApi);
                    });
                });
                
                if (api) {
                    this.activeApis.set(cookieIndex, api);
                } else {
                    return false;
                }
            } catch (error) {
                return false;
            }
        }
        
        const api = this.activeApis.get(cookieIndex);
        
        return new Promise((resolve) => {
            if (this.is15Digit) {
                sendTo15DigitChat(api, messageText, this.groupUID, (err) => {
                    if (err) {
                        this.activeApis.delete(cookieIndex);
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            } else {
                api.sendMessage(messageText, this.groupUID, (err) => {
                    if (err) {
                        this.activeApis.delete(cookieIndex);
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            }
        });
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            sessionHeartbeats.set(this.sessionId, Date.now());
        }, 30000);
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== COOKIE REFRESH ====================
function refreshCookie(api, callback) {
    if (!api || !api.getAppState) {
        callback(null);
        return;
    }
    
    try {
        const newAppState = api.getAppState();
        callback(newAppState);
    } catch (error) {
        Logger.error(`Cookie refresh error: ${error.message}`);
        callback(null);
    }
}

// ==================== AUTO RECOVERY ====================
class AutoRecoverySystem {
    constructor() {
        this.recoveryInterval = null;
    }
    
    start() {
        if (this.recoveryInterval) clearInterval(this.recoveryInterval);
        
        this.recoveryInterval = setInterval(() => {
            this.checkAndRecover();
        }, 30000);
        
        Logger.log('Auto-recovery system started');
    }
    
    async checkAndRecover() {
        try {
            for (const [sessionId, session] of activeSessions) {
                const lastBeat = sessionHeartbeats.get(sessionId);
                if (!lastBeat || Date.now() - lastBeat > 90000) {
                    Logger.log(`Recovering session: ${sessionId}`);
                    
                    if (session.type === 'multi_messaging' && session.messager) {
                        if (!session.messager.isRunning) {
                            session.messager.start();
                        }
                    } else if (session.type === 'single_messaging' && session.messaging) {
                        if (!session.messaging.isRunning) {
                            session.messaging.start();
                        }
                    }
                    
                    sessionHeartbeats.set(sessionId, Date.now());
                }
            }
        } catch (error) {
            Logger.error(`Recovery error: ${error.message}`);
        }
    }
    
    stop() {
        if (this.recoveryInterval) {
            clearInterval(this.recoveryInterval);
            this.recoveryInterval = null;
        }
    }
}

// ==================== API ENDPOINTS ====================

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'running',
        uptime: process.uptime(),
        sessions: activeSessions.size
    });
});

// Start messaging
app.post('/start', async (req, res) => {
    try {
        const fileData = readFiles();
        
        if (!fileData.cookies || fileData.cookies.length === 0) {
            return res.status(400).json({ error: 'cookies.txt is empty' });
        }
        
        if (!fileData.convo) {
            return res.status(400).json({ error: 'convo.txt is empty' });
        }
        
        if (!fileData.messages || fileData.messages.length === 0) {
            return res.status(400).json({ error: 'File.txt is empty' });
        }
        
        const sessionId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        if (fileData.cookies.length === 1) {
            const messaging = new MessagingSystem(
                sessionId,
                fileData.cookies[0],
                fileData.convo,
                fileData.haters,
                fileData.lastNames,
                fileData.messages
            );
            
            const initialized = await messaging.initialize();
            if (!initialized) {
                return res.status(400).json({ error: 'Login failed' });
            }
            
            messaging.start();
            
            activeSessions.set(sessionId, {
                messaging,
                type: 'single_messaging',
                startTime: Date.now()
            });
            
            sessionHeartbeats.set(sessionId, Date.now());
            
            res.status(200).json({ 
                success: true, 
                sessionId,
                type: 'single',
                message: 'Started single cookie messaging',
                delay: fileData.timeDelay
            });
            
        } else {
            const messager = new MultiCookieMessagingSystem(
                sessionId,
                fileData.cookies,
                fileData.convo,
                fileData.haters,
                fileData.lastNames,
                fileData.messages
            );
            
            const initialized = await messager.initializeAllCookiesOnce();
            if (!initialized) {
                return res.status(400).json({ error: 'Failed to login with any cookie' });
            }
            
            messager.start();
            
            activeSessions.set(sessionId, {
                messager,
                type: 'multi_messaging',
                startTime: Date.now()
            });
            
            sessionHeartbeats.set(sessionId, Date.now());
            
            res.status(200).json({ 
                success: true, 
                sessionId,
                type: 'multi',
                cookiesCount: fileData.cookies.length,
                message: `Started with ${fileData.cookies.length} cookies`,
                delay: fileData.timeDelay
            });
        }
        
    } catch (error) {
        Logger.error(`Start error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Stop session
app.post('/stop', (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Missing session ID' });
        }
        
        const session = activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        if (session.messager) {
            session.messager.stop();
        }
        
        if (session.messaging) {
            session.messaging.stop();
        }
        
        activeSessions.delete(sessionId);
        sessionHeartbeats.delete(sessionId);
        
        res.status(200).json({ success: true, message: 'Session stopped' });
        
    } catch (error) {
        Logger.error(`Stop error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Get status
app.post('/status', (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Missing session ID' });
        }
        
        const session = activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        let status = {};
        if (session.type === 'multi_messaging' && session.messager) {
            status = {
                type: 'multi',
                isRunning: session.messager.isRunning,
                messagesSent: session.messager.messagesSent,
                queueLength: session.messager.messageQueue.length,
                totalMessages: session.messager.originalMessages.length,
                uptime: Date.now() - session.messager.startTime,
                is15Digit: session.messager.is15Digit,
                activeCookies: session.messager.activeApis.size,
                totalCookies: session.messager.originalCookies.length
            };
        } else if (session.type === 'single_messaging' && session.messaging) {
            status = {
                type: 'single',
                isRunning: session.messaging.isRunning,
                messagesSent: session.messaging.messagesSent,
                queueLength: session.messaging.messageQueue.length,
                totalMessages: session.messaging.originalMessages.length,
                uptime: Date.now() - session.messaging.startTime,
                is15Digit: session.messaging.is15Digit
            };
        }
        
        sessionHeartbeats.set(sessionId, Date.now());
        
        res.status(200).json({ success: true, status });
        
    } catch (error) {
        Logger.error(`Status error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// List all sessions
app.get('/sessions', (req, res) => {
    try {
        const sessions = [];
        
        for (const [sessionId, session] of activeSessions) {
            sessions.push({
                sessionId,
                type: session.type,
                startTime: session.startTime,
                uptime: Date.now() - session.startTime
            });
        }
        
        res.status(200).json({ 
            success: true, 
            sessions,
            count: sessions.length
        });
        
    } catch (error) {
        Logger.error(`List error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Check files
app.get('/files', (req, res) => {
    try {
        const fileData = readFiles();
        
        res.status(200).json({
            success: true,
            files: {
                cookies: fileData.cookies.length,
                timeDelay: fileData.timeDelay,
                convo: fileData.convo,
                haters: fileData.haters.length,
                lastNames: fileData.lastNames.length,
                messages: fileData.messages.length
            }
        });
        
    } catch (error) {
        Logger.error(`Files error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'Messaging System',
        version: '1.0',
        endpoints: {
            'GET /health': 'Server health',
            'POST /start': 'Start messaging',
            'POST /stop': 'Stop session',
            'POST /status': 'Get session status',
            'GET /sessions': 'List sessions',
            'GET /files': 'Check files'
        }
    });
});

// ==================== START SERVER ====================
const autoRecovery = new AutoRecoverySystem();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HTTP Server running on port ${PORT}`);
    console.log(`📁 Reading from: cookies.txt, time.txt, convo.txt, hatersname.txt, lastname.txt, File.txt`);
    console.log(`✅ 15-digit chat support: ENABLED`);
    console.log(`✅ Auto cookie refresh: Every 48 hours`);
    console.log(`✅ Auto recovery: ENABLED`);
    console.log(`✅ Time.txt delay: Active (0 = no delay)`);
    
    autoRecovery.start();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    
    for (const [sessionId, session] of activeSessions) {
        try {
            if (session.messager) session.messager.stop();
            if (session.messaging) session.messaging.stop();
        } catch (error) {}
    }
    
    autoRecovery.stop();
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});

process.on('uncaughtException', (error) => {
    console.log(`Uncaught: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.log(`Unhandled: ${reason}`);
});
