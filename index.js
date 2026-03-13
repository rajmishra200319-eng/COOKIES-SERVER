// ==================== ULTIMATE ANTI-STUCK SYSTEM ====================

// TOP pe ye sab variables add karo
const fs = require('fs');
const path = require('path');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 4000;

// ========== CRITICAL: Message Tracking System ==========
let lastMessageTime = Date.now();
let lastSuccessTime = Date.now();
let messageSendCount = 0;
let failedAttempts = 0;
let consecutiveErrors = 0;
let loopHealthCheck = {
  lastIteration: Date.now(),
  iterationCount: 0,
  stuckCount: 0
};

// ========== MAIN CONFIG ==========
let config = {
  delay: 10,
  running: false,
  currentCookieIndex: 0,
  cookies: []
};

let messageData = {
  threadID: '',
  messages: [],
  currentIndex: 0,
  loopCount: 0,
  hatersName: [],
  lastName: []
};

let wss;

// Session directory
const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// ========== 15-DIGIT CHAT SUPPORT ==========
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

// ========== ULTIMATE HEARTBEAT - Har second active ==========
setInterval(() => {
  const now = Date.now();
  
  // Always log heartbeat if running
  if (config.running) {
    // Har 30 second pe status
    if (now - lastSuccessTime > 30000) {
      console.log(`💓 [${new Date().toISOString()}] BOT STATUS: Running | Last success: ${lastSuccessTime ? Math.round((now - lastSuccessTime)/1000) + 's ago' : 'Never'}`);
    }
    
    // CRITICAL: Check if loop is stuck (no iteration for 2 minutes)
    if (now - loopHealthCheck.lastIteration > 120000) {
      console.log(`🚨 CRITICAL: Loop stuck! No iteration for ${Math.round((now - loopHealthCheck.lastIteration)/1000)}s`);
      loopHealthCheck.stuckCount++;
      
      // Agar 3 baar stuck ho chuka hai to force restart
      if (loopHealthCheck.stuckCount >= 3) {
        console.log('💥 Force restarting due to multiple stuck events');
        process.exit(1);
      }
    }
    
    // Check message sending status
    if (now - lastMessageTime > 180000) { // 3 minutes
      console.log(`🔥 EMERGENCY: No message for ${Math.round((now - lastMessageTime)/1000)}s!`);
      console.log('🔄 Force resetting message system...');
      
      // Try to recover
      messageData.currentIndex = Math.max(0, messageData.currentIndex - 1); // Retry last message
      lastMessageTime = now; // Reset timer to avoid multiple restarts
      consecutiveErrors++;
      
      // Agar consecutive errors 5 se zyada to restart
      if (consecutiveErrors > 5) {
        console.log('💥 Too many consecutive errors - restarting');
        process.exit(1);
      }
    } else {
      // Reset consecutive errors on success
      consecutiveErrors = 0;
    }
  }
}, 1000); // HAR SECOND CHECK - Most important

// ========== CLASSES ==========
class RawSessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionQueue = [];
    this.sessionFile = path.join(SESSION_DIR, 'sessions.json');
    this.loadSessions();
    this.startHeartbeat();
    this.startMemoryCleanup();
    this.startCookieRefreshTimer();
    this.startAutoRecovery();
  }

  loadSessions() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        console.log(`📂 Loaded ${Object.keys(data).length} saved sessions`);
      }
    } catch (error) {
      console.log('⚠️ No saved sessions found');
    }
  }

  saveSession(index, sessionData) {
    try {
      const sessions = {};
      for (let [idx, session] of this.sessions) {
        if (session.appState) {
          sessions[idx] = {
            appState: session.appState,
            userId: session.userId,
            lastUsed: Date.now()
          };
        }
      }
      fs.writeFileSync(this.sessionFile, JSON.stringify(sessions, null, 2));
    } catch (error) {
      console.log(`⚠️ Failed to save session: ${error.message}`);
    }
  }

  async createRawSession(cookieContent, index) {
    return new Promise((resolve) => {
      console.log(`🔐 Creating session ${index + 1}...`);
      
      wiegine.login(cookieContent, { 
        logLevel: "silent",
        forceLogin: true,
        selfListen: false
      }, (err, api) => {
        if (err || !api) {
          console.log(`❌ Session ${index + 1} failed:`, err?.error || 'Unknown error');
          
          // INFINITE RETRY
          setTimeout(() => {
            this.createRawSession(cookieContent, index).then(resolve);
          }, 10000);
          return;
        }

        console.log(`✅ Session ${index + 1} created successfully`);
        
        const userId = api.getCurrentUserID();
        const appState = api.getAppState ? api.getAppState() : null;
        
        this.testGroupAccess(api, index).then((canAccess) => {
          const sessionInfo = { 
            api, 
            healthy: canAccess,
            userId,
            appState,
            lastUsed: Date.now(),
            createdAt: Date.now(),
            failCount: 0
          };
          
          if (canAccess) {
            this.sessions.set(index, sessionInfo);
            this.sessionQueue.push(index);
            this.saveSession(index, sessionInfo);
            console.log(`🎯 Session ${index + 1} can access groups`);
          } else {
            console.log(`⚠️ Session ${index + 1} group access limited`);
            this.sessions.set(index, { ...sessionInfo, healthy: false });
          }
          resolve(api);
        });
      });
    });
  }

  async testGroupAccess(api, index) {
    return new Promise((resolve) => {
      api.getThreadInfo(messageData.threadID, (err, info) => {
        if (!err && info) {
          console.log(`✅ Session ${index + 1} - Thread access confirmed`);
          resolve(true);
          return;
        }

        api.sendMessage("🧪 Test", messageData.threadID, (err2) => {
          if (!err2) {
            console.log(`✅ Session ${index + 1} - Test message successful`);
            resolve(true);
          } else {
            console.log(`❌ Session ${index + 1} - Test message failed:`, err2?.error);
            resolve(false);
          }
        });
      });
    });
  }

  getNextSession() {
    if (this.sessionQueue.length === 0) return null;
    const nextIndex = this.sessionQueue.shift();
    this.sessionQueue.push(nextIndex);
    return this.sessions.get(nextIndex)?.api || null;
  }

  getHealthySessions() {
    const healthy = [];
    for (let [index, session] of this.sessions) {
      if (session.healthy && session.api) {
        healthy.push(session.api);
      }
    }
    return healthy;
  }

  startHeartbeat() {
    setInterval(() => {
      this.checkSessionsHealth();
    }, 5 * 60 * 1000);
  }

  async checkSessionsHealth() {
    console.log('💓 Running heartbeat check...');
    
    for (let [index, session] of this.sessions) {
      if (!session.api) {
        session.healthy = false;
        continue;
      }

      try {
        await new Promise((resolve) => {
          session.api.getUserID('4', (err) => {
            if (err) {
              console.log(`💔 Session ${index + 1} heartbeat failed`);
              session.healthy = false;
              session.failCount = (session.failCount || 0) + 1;
              session.lastUsed = Date.now();
              this.refreshSessionCookie(index);
            } else {
              session.healthy = true;
              session.failCount = 0;
              session.lastUsed = Date.now();
            }
            resolve();
          });
        });
      } catch (e) {
        session.healthy = false;
      }
    }
  }

  startMemoryCleanup() {
    setInterval(() => {
      this.cleanupMemory();
    }, 30 * 60 * 1000);
  }

  cleanupMemory() {
    console.log('🧹 Running memory cleanup...');
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    
    for (let [index, session] of this.sessions) {
      if (!session.healthy && (now - session.lastUsed) > ONE_HOUR && session.failCount > 5) {
        console.log(`🗑️ Removing stale session ${index + 1}`);
        this.sessions.delete(index);
        this.sessionQueue = this.sessionQueue.filter(i => i !== index);
      }
      
      if (session.api && !session.healthy && session.failCount > 10) {
        session.api = null;
      }
    }

    const used = process.memoryUsage();
    console.log(`📊 Memory: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
  }

  startCookieRefreshTimer() {
    setInterval(() => {
      this.refreshAllCookies();
    }, 24 * 60 * 60 * 1000);
  }

  refreshAllCookies() {
    console.log('🔄 Starting scheduled cookie refresh...');
    
    for (let [index, session] of this.sessions) {
      if (session.api && session.api.getAppState) {
        this.refreshSessionCookie(index);
      }
    }
  }

  refreshSessionCookie(index) {
    const session = this.sessions.get(index);
    if (!session || !session.api) return;

    try {
      const newAppState = session.api.getAppState();
      if (newAppState) {
        session.appState = newAppState;
        session.lastRefresh = Date.now();
        this.saveSession(index, session);
        console.log(`✅ Cookie refreshed for session ${index + 1}`);
      }
    } catch (error) {
      console.log(`❌ Cookie refresh failed for session ${index + 1}: ${error.message}`);
    }
  }

  startAutoRecovery() {
    setInterval(() => {
      this.recoverDeadSessions();
    }, 5 * 60 * 1000);
  }

  recoverDeadSessions() {
    console.log('🚑 Checking for dead sessions to recover...');
    
    for (let [index, session] of this.sessions) {
      if (!session.healthy && session.appState && session.failCount > 3) {
        console.log(`🔄 Attempting to recover session ${index + 1}`);
        
        wiegine.login({ appState: session.appState }, { logLevel: "silent" }, (err, api) => {
          if (!err && api) {
            console.log(`✅ Session ${index + 1} recovered successfully`);
            session.api = api;
            session.healthy = true;
            session.failCount = 0;
            session.lastUsed = Date.now();
            this.testGroupAccess(api, index);
          } else {
            console.log(`❌ Session ${index + 1} recovery failed`);
          }
        });
      }
    }
  }

  async ensureSession(index, cookie) {
    if (!this.sessions.has(index)) {
      console.log(`🆕 Creating missing session ${index + 1}`);
      await this.createRawSession(cookie, index);
    }
    return this.sessions.get(index);
  }

  shutdown() {
    console.log('💾 Saving sessions before shutdown...');
    for (let [index, session] of this.sessions) {
      this.saveSession(index, session);
    }
  }
}

const rawManager = new RawSessionManager();

// ========== ENHANCED MESSAGE SENDER WITH TIMEOUT ==========
class RawMessageSender {
  async sendRawMessage(api, message, threadID) {
    return new Promise((resolve) => {
      const is15Digit = is15DigitChat(threadID);
      
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        console.log('⏰ Message send timeout');
        resolve(false);
      }, 15000); // 15 second timeout
      
      const callback = (err) => {
        clearTimeout(timeout);
        if (!err) {
          resolve(true);
        } else {
          console.log('❌ Send error:', err?.error || 'Unknown error');
          resolve(false);
        }
      };
      
      if (is15Digit) {
        sendTo15DigitChat(api, message, threadID, callback);
      } else {
        api.sendMessage(message, threadID, callback);
      }
    });
  }

  async sendMessageToGroup(finalMessage) {
    // Pehle healthy sessions check karo
    let healthySessions = rawManager.getHealthySessions();
    
    // Agar koi healthy nahi to recovery attempt karo
    if (healthySessions.length === 0) {
      console.log('⚠️ No healthy sessions, attempting recovery...');
      rawManager.recoverDeadSessions();
      
      // Wait for recovery with yielding
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        await new Promise(resolve => setImmediate(resolve));
      }
      
      // Dobara check karo
      healthySessions = rawManager.getHealthySessions();
    }

    // Har session se try karo with timeout
    for (const api of healthySessions) {
      try {
        const success = await this.sendRawMessage(api, finalMessage, messageData.threadID);
        if (success) {
          return true;
        }
      } catch (e) {
        console.log(`Session error: ${e.message}`);
      }
      
      // Yield between sessions
      await new Promise(resolve => setImmediate(resolve));
    }

    return false;
  }
}

const rawSender = new RawMessageSender();

// ========== MAIN LOOP WITH ULTIMATE PROTECTION ==========
async function runRawLoop() {
  console.log('🔄 Starting ULTIMATE PROTECTED loop...');
  
  while (config.running) {
    try {
      // CRITICAL #1: Update loop health
      loopHealthCheck.lastIteration = Date.now();
      loopHealthCheck.iterationCount++;
      
      // CRITICAL #2: Event loop yield - Must be first thing
      await new Promise(resolve => setImmediate(resolve));
      
      // CRITICAL #3: Double-check running state
      if (!config.running) {
        console.log('⏹️ Loop stopped by config');
        break;
      }

      // Check if we have any healthy sessions
      let healthySessions = rawManager.getHealthySessions();
      
      // Agar koi healthy nahi to recovery karo
      if (healthySessions.length === 0) {
        console.log('🔄 No healthy sessions, running recovery...');
        rawManager.recoverDeadSessions();
        
        // Wait with yielding
        for (let i = 0; i < 15; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await new Promise(resolve => setImmediate(resolve));
        }
        
        // Check again
        healthySessions = rawManager.getHealthySessions();
        
        // Agar still no sessions to continue loop but wait
        if (healthySessions.length === 0) {
          console.log('⏳ Waiting for sessions...');
          for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await new Promise(resolve => setImmediate(resolve));
          }
          continue;
        }
      }

      // Message processing
      if (messageData.messages.length === 0) {
        console.log('❌ No messages to send');
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await new Promise(resolve => setImmediate(resolve));
        }
        continue;
      }

      // Reset index if needed
      if (messageData.currentIndex >= messageData.messages.length) {
        messageData.loopCount++;
        messageData.currentIndex = 0;
        console.log(`🎯 Loop #${messageData.loopCount} completed, starting new loop`);
        
        // Yield after loop completion
        await new Promise(resolve => setImmediate(resolve));
      }

      // Prepare message
      const rawMessage = messageData.messages[messageData.currentIndex];
      const randomName = getRandomName();
      const finalMessage = `${randomName} ${rawMessage}`;

      console.log(`📤 [${new Date().toISOString()}] Sending message ${messageData.currentIndex + 1}/${messageData.messages.length}`);

      // CRITICAL #4: Send with timeout protection
      const sendPromise = rawSender.sendMessageToGroup(finalMessage);
      const timeoutPromise = new Promise(resolve => setTimeout(() => {
        console.log('⏰ Message timeout - forcing retry');
        resolve(false);
      }, 25000)); // 25 second timeout
      
      const success = await Promise.race([sendPromise, timeoutPromise]);

      if (success) {
        console.log(`✅ Message ${messageData.currentIndex + 1} sent successfully`);
        messageData.currentIndex++;
        lastMessageTime = Date.now();
        lastSuccessTime = Date.now();
        messageSendCount++;
        consecutiveErrors = 0; // Reset on success
      } else {
        console.log('❌ Message failed, will retry same message');
        failedAttempts++;
        consecutiveErrors++;
        
        // Agar 10 consecutive errors to recovery
        if (consecutiveErrors > 10) {
          console.log('⚠️ Too many errors - running recovery');
          rawManager.recoverDeadSessions();
        }
      }

      // Read delay from time.txt
      try {
        const timePath = path.join(__dirname, 'time.txt');
        if (fs.existsSync(timePath)) {
          const timeContent = fs.readFileSync(timePath, 'utf8').trim();
          const newDelay = parseInt(timeContent);
          if (!isNaN(newDelay) && newDelay > 0) {
            config.delay = newDelay;
          }
        }
      } catch (e) {
        // Ignore file read errors
      }

      console.log(`⏱️ Waiting ${config.delay} seconds...`);
      
      // CRITICAL #5: Smart delay with yielding
      for (let i = 0; i < config.delay; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await new Promise(resolve => setImmediate(resolve)); // Yield every second
      }

    } catch (error) {
      console.log(`🛡️ Loop error: ${error.message}`);
      
      // Error recovery with yielding
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
  
  console.log('⏹️ Loop stopped (manual stop)');
}

// ========== SESSION CREATION ==========
async function createRawSessions() {
  console.log('🏗️ Creating sessions...');
  
  for (let i = 0; i < config.cookies.length; i++) {
    await rawManager.createRawSession(config.cookies[i], i);
    // Yield between sessions
    await new Promise(resolve => setImmediate(resolve));
  }
  
  const healthyCount = rawManager.getHealthySessions().length;
  console.log(`✅ ${healthyCount}/${config.cookies.length} sessions healthy`);
}

// ========== FILE READING ==========
function readRequiredFiles() {
  try {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (!fs.existsSync(cookiesPath)) throw new Error('cookies.txt not found');
    
    const cookiesContent = fs.readFileSync(cookiesPath, 'utf8');
    config.cookies = cookiesContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//'));

    if (config.cookies.length === 0) throw new Error('No valid cookies found');

    const convoPath = path.join(__dirname, 'convo.txt');
    if (!fs.existsSync(convoPath)) throw new Error('convo.txt not found');
    
    messageData.threadID = fs.readFileSync(convoPath, 'utf8').trim();
    if (!/^\d+$/.test(messageData.threadID)) {
      throw new Error('Thread ID must be numeric');
    }

    const hatersPath = path.join(__dirname, 'hatersname.txt');
    const lastnamePath = path.join(__dirname, 'lastname.txt');
    const filePath = path.join(__dirname, 'File.txt');
    const timePath = path.join(__dirname, 'time.txt');

    [hatersPath, lastnamePath, filePath, timePath].forEach(file => {
      if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} not found`);
    });

    messageData.hatersName = fs.readFileSync(hatersPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
    messageData.lastName = fs.readFileSync(lastnamePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
    messageData.messages = fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
    
    const timeContent = fs.readFileSync(timePath, 'utf8').trim();
    config.delay = parseInt(timeContent) || 10;
    
    console.log('✅ All files loaded successfully');
    console.log('📌 Thread ID:', messageData.threadID);
    console.log('🍪 Cookies:', config.cookies.length);
    console.log('💬 Messages:', messageData.messages.length);
    console.log('⏱️ Delay:', config.delay, 'seconds');
    
    return true;
  } catch (error) {
    console.error('❌ File error:', error.message);
    return false;
  }
}

// ========== UTILITY FUNCTIONS ==========
function getRandomName() {
  const randomHater = messageData.hatersName[Math.floor(Math.random() * messageData.hatersName.length)];
  const randomLastName = messageData.lastName[Math.floor(Math.random() * messageData.lastName.length)];
  return `${randomHater} ${randomLastName}`;
}

// ========== START/STOP FUNCTIONS ==========
async function startRawSending() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 STARTING BOT WITH ULTIMATE ANTI-STUCK PROTECTION');
  console.log('='.repeat(60));
  console.log(`📅 Time: ${new Date().toISOString()}`);
  console.log(`📌 Process ID: ${process.pid}`);
  console.log(`💻 Platform: ${process.platform}`);
  console.log('='.repeat(60));
  
  if (!readRequiredFiles()) {
    console.log('❌ File check failed! Cannot start');
    return;
  }
  
  config.running = true;
  messageData.currentIndex = 0;
  messageData.loopCount = 0;
  lastMessageTime = Date.now();
  lastSuccessTime = Date.now();
  messageSendCount = 0;
  failedAttempts = 0;
  consecutiveErrors = 0;
  loopHealthCheck.lastIteration = Date.now();
  loopHealthCheck.stuckCount = 0;

  console.log('🔄 Creating sessions...');
  await createRawSessions();
  
  const healthyCount = rawManager.getHealthySessions().length;
  console.log(`✅ Healthy sessions: ${healthyCount}/${config.cookies.length}`);
  
  if (healthyCount > 0) {
    console.log('🎯 Starting protected loop...');
    // Don't await - let it run in background
    runRawLoop().catch(error => {
      console.log('❌ Fatal loop error:', error);
      console.log('🔄 Restarting loop in 30s...');
      setTimeout(() => {
        if (config.running) {
          runRawLoop();
        }
      }, 30000);
    });
    
    console.log('✅ Bot started successfully! Messages will send continuously.');
  } else {
    console.log('⚠️ No healthy sessions - but will keep trying');
    runRawLoop();
  }
}

function stopRawSending() {
  config.running = false;
  rawManager.shutdown();
  console.log('⏹️ System stopped (manual stop)');
  console.log(`📊 Stats - Messages sent: ${messageSendCount}, Failed: ${failedAttempts}`);
}

// ========== EXPRESS SETUP ==========
app.use(express.json());

app.post('/api/start', (req, res) => {
  startRawSending();
  res.json({ 
    success: true, 
    message: 'Bot started with ULTIMATE protection',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/stop', (req, res) => {
  stopRawSending();
  res.json({ 
    success: true, 
    message: 'Bot stopped',
    stats: {
      messagesSent: messageSendCount,
      failedAttempts: failedAttempts
    }
  });
});

app.get('/api/status', (req, res) => {
  const healthyCount = rawManager.getHealthySessions().length;
  const used = process.memoryUsage();
  const now = Date.now();
  const lastMsgAgo = Math.round((now - lastMessageTime) / 1000);
  const lastSuccessAgo = Math.round((now - lastSuccessTime) / 1000);
  
  res.json({
    running: config.running,
    mode: 'ULTIMATE PROTECTED',
    currentIndex: messageData.currentIndex,
    totalMessages: messageData.messages.length,
    loopCount: messageData.loopCount,
    messagesSent: messageSendCount,
    failedAttempts: failedAttempts,
    healthySessions: healthyCount,
    totalCookies: config.cookies.length,
    delay: config.delay,
    lastMessage: {
      timeAgo: lastMsgAgo + 's',
      timestamp: new Date(lastMessageTime).toISOString()
    },
    lastSuccess: {
      timeAgo: lastSuccessAgo + 's',
      timestamp: new Date(lastSuccessTime).toISOString()
    },
    loopHealth: {
      lastIteration: new Date(loopHealthCheck.lastIteration).toISOString(),
      iterations: loopHealthCheck.iterationCount,
      stuckCount: loopHealthCheck.stuckCount
    },
    consecutiveErrors: consecutiveErrors,
    memory: {
      rss: Math.round(used.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB'
    },
    uptime: Math.floor(process.uptime() / 3600) + 'h ' + 
             Math.floor((process.uptime() % 3600) / 60) + 'm ' +
             Math.floor(process.uptime() % 60) + 's',
    timestamp: new Date().toISOString(),
    message: '✅ Bot is RUNNING and will never stop!'
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Facebook Bot - ULTIMATE PROTECTION</title>
        <style>
          body { font-family: Arial; padding: 20px; background: #f0f2f5; }
          button { padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer; }
          #status { margin-top: 20px; padding: 10px; background: white; border-radius: 5px; }
          .green { color: green; font-weight: bold; }
          .red { color: red; }
          .stats { margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Facebook Bot <span class="green">(ULTIMATE PROTECTION)</span></h1>
        <p>✅ This bot will NEVER stop running!</p>
        <div>
          <button onclick="start()">Start Bot</button>
          <button onclick="stop()">Stop Bot</button>
          <button onclick="getStatus()">Refresh Status</button>
        </div>
        <div id="status">Loading status...</div>
        <script>
          function start() { 
            fetch('/api/start', {method: 'POST'})
              .then(r => r.json()).then(d => showStatus(d));
          }
          function stop() { 
            fetch('/api/stop', {method: 'POST'})
              .then(r => r.json()).then(d => showStatus(d));
          }
          function getStatus() {
            fetch('/api/status')
              .then(r => r.json()).then(d => showStatus(d));
          }
          function showStatus(data) {
            let html = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
            if (data.running) {
              html += '<p class="green">✅ BOT IS RUNNING - Messages sending continuously</p>';
            } else {
              html += '<p class="red">⏹️ BOT IS STOPPED</p>';
            }
            document.getElementById('status').innerHTML = html;
          }
          // Auto refresh every 5 seconds
          setInterval(getStatus, 5000);
          // Initial load
          getStatus();
        </script>
      </body>
    </html>
  `);
});

// ========== SERVER START ==========
const server = app.listen(PORT, () => {
  console.log(`\n💎 Server running at http://localhost:${PORT}`);
  console.log(`🚀 ULTIMATE PROTECTION MODE - Will run forever until manual stop`);
  console.log(`🔄 AUTO-STARTING IN 3 SECONDS...`);
  
  setTimeout(() => {
    startRawSending();
  }, 3000);
});

wss = new WebSocket.Server({ server });

// ========== GITHUB ACTIONS OPTIMIZATION ==========
if (process.env.GITHUB_ACTIONS) {
  console.log('🤖 Running in GitHub Actions - Optimizing for 6-hour runs');
  
  // GitHub Actions heartbeat - har minute
  setInterval(() => {
    if (config.running) {
      const stats = {
        time: new Date().toISOString(),
        messages: messageSendCount,
        lastSuccess: lastSuccessTime ? Math.round((Date.now() - lastSuccessTime)/1000) + 's ago' : 'Never',
        healthySessions: rawManager.getHealthySessions().length,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      };
      console.log(`🤖 GitHub Heartbeat:`, stats);
    }
  }, 60000);
}

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGINT', () => {
  console.log('\n👋 Manual shutdown initiated...');
  stopRawSending();
  setTimeout(() => {
    console.log('👋 Goodbye!');
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM...');
  stopRawSending();
  process.exit(0);
});

// ========== ERROR HANDLING - Never exit ==========
process.on('uncaughtException', (error) => {
  console.log('🛡️ Uncaught Exception:', error.message);
  console.log(error.stack);
  console.log('🔄 Continuing execution...');
  // Don't exit
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('🛡️ Unhandled Rejection:', reason);
  console.log('🔄 Continuing execution...');
  // Don't exit
});

// ========== FINAL CHECK - Har 5 minute ==========
setInterval(() => {
  if (config.running) {
    const now = Date.now();
    const lastSuccessAgo = Math.round((now - lastSuccessTime) / 1000 / 60); // minutes
    
    console.log(`📊 STATUS CHECK - Running: Yes | Last success: ${lastSuccessAgo}m ago | Msgs: ${messageSendCount}`);
    
    // Agar 10 minute se koi success nahi to restart
    if (lastSuccessAgo > 10) {
      console.log(`🔥 No success for ${lastSuccessAgo} minutes - Force restarting`);
      process.exit(1);
    }
  }
}, 300000); // Har 5 minute
