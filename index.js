// ==================== ULTIMATE ANTI-STOP + ANTI-SLEEP SYSTEM ====================

const fs = require('fs');
const path = require('path');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 4000;
const RENDER_URL = 'https://testing-by-raj.onrender.com'; // Tumhara URL

// ========== CRITICAL: Message Tracking System ==========
let lastMessageTime = Date.now();
let lastSuccessTime = Date.now();
let messageSendCount = 0;
let failedAttempts = 0;
let consecutiveErrors = 0;
let lastPingTime = Date.now();
let pingCount = 0;
let wakeupAttempts = 0;
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

// ========== 15-DIGIT CHAT SUPPORT - FIXED ==========
function is15DigitChat(threadID) {
  return /^\d{15}$/.test(String(threadID));
}

function sendTo15DigitChat(api, message, threadID, callback, retryAttempt = 0) {
  const maxRetries = 5;
  
  try {
    // CRITICAL FIX: 15-digit chat ke liye special handling
    api.sendMessage({ body: message }, threadID, (err) => {
      if (err) {
        // Try with numeric conversion
        try {
          const numericThreadID = threadID.toString();
          api.sendMessage(message, numericThreadID, (err2) => {
            if (err2 && retryAttempt < maxRetries) {
              console.log(`🔄 Retry ${retryAttempt + 1}/${maxRetries} for 15-digit chat`);
              setTimeout(() => {
                sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
              }, 5000);
            } else {
              callback(err2 || null);
            }
          });
        } catch (e) {
          callback(e);
        }
      } else {
        callback(null);
      }
    });
  } catch (error) {
    if (retryAttempt < maxRetries) {
      setTimeout(() => {
        sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
      }, 5000);
    } else {
      callback(error);
    }
  }
}

// ========== ULTIMATE HEARTBEAT ==========
setInterval(() => {
  const now = Date.now();
  
  if (config.running) {
    const timeSinceLastSuccess = now - lastSuccessTime;
    
    if (timeSinceLastSuccess > 120000) {
      console.log(`🚨 CRITICAL: No success for ${Math.round(timeSinceLastSuccess/1000)}s`);
      messageData.currentIndex = Math.max(0, messageData.currentIndex - 1);
      lastSuccessTime = now;
      rawManager.recoverDeadSessions();
      consecutiveErrors++;
      
      if (consecutiveErrors > 5) {
        console.log('💥 Too many errors - Force restarting process');
        process.exit(1);
      }
    } else {
      consecutiveErrors = 0;
    }
    
    if (now - loopHealthCheck.lastIteration > 180000) {
      console.log(`🔥 Loop stuck! No iteration for ${Math.round((now - loopHealthCheck.lastIteration)/1000)}s`);
      loopHealthCheck.stuckCount++;
      
      if (loopHealthCheck.stuckCount >= 3) {
        console.log('💥 Multiple stuck events - Restarting');
        process.exit(1);
      }
    }
  }
}, 5000);

// ========== RENDER ANTI-SLEEP PING SYSTEM ==========

// Internal ping - Har 30 second
setInterval(() => {
  if (config.running) {
    http.get(`http://localhost:${PORT}/api/ping`, (res) => {
      pingCount++;
      lastPingTime = Date.now();
    }).on('error', (err) => {
      console.log(`⚠️ Internal ping failed: ${err.message}`);
    });
  }
}, 30000);

// External ping - Har 5 minute
setInterval(() => {
  if (config.running) {
    https.get(`${RENDER_URL}/api/ping`, (res) => {
      console.log(`🌐 External ping to Render successful at ${new Date().toISOString()}`);
    }).on('error', (err) => {
      console.log(`⚠️ External ping failed: ${err.message}`);
    });
  }
}, 300000);

// Wake-up detector - Har minute
setInterval(() => {
  const now = Date.now();
  const timeSinceLastPing = now - lastPingTime;
  const timeSinceLastSuccess = now - lastSuccessTime;
  
  if (config.running && (timeSinceLastPing > 120000 || timeSinceLastSuccess > 180000)) {
    wakeupAttempts++;
    console.log(`⏰ WAKE-UP DETECTED! Attempt #${wakeupAttempts}`);
    
    http.get(`http://localhost:${PORT}/api/wakeup`, (res) => {
      console.log(`✅ Wake-up ping sent at ${new Date().toISOString()}`);
      lastPingTime = Date.now();
    }).on('error', (err) => {
      console.log(`❌ Wake-up failed: ${err.message}`);
      
      if (wakeupAttempts >= 3) {
        console.log('💥 Wake-up failed 3 times - Force restarting');
        process.exit(1);
      }
    });
    
    if (timeSinceLastSuccess > 180000) {
      messageData.currentIndex = Math.max(0, messageData.currentIndex - 1);
      lastSuccessTime = Date.now();
    }
  } else {
    wakeupAttempts = 0;
  }
}, 60000);

// ========== CLASSES ==========
class RawSessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionQueue = [];
    this.sessionFile = path.join(SESSION_DIR, 'sessions.json');
    this.loadSessions();
    this.startHeartbeat();
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
          
          setTimeout(() => {
            this.createRawSession(cookieContent, index).then(resolve);
          }, 10000);
          return;
        }

        console.log(`✅ Session ${index + 1} created`);
        
        const appState = api.getAppState ? api.getAppState() : null;
        
        const sessionInfo = { 
          api, 
          healthy: true,
          appState,
          lastUsed: Date.now(),
          failCount: 0
        };
        
        this.sessions.set(index, sessionInfo);
        this.sessionQueue.push(index);
        this.saveSession(index, sessionInfo);
        
        resolve(api);
      });
    });
  }

  getHealthySessions() {
    const healthy = [];
    for (let [index, session] of this.sessions) {
      if (session.api) {
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
    console.log('💓 Running heartbeat...');
    
    for (let [index, session] of this.sessions) {
      if (!session.api) {
        continue;
      }

      try {
        await new Promise((resolve) => {
          session.api.getUserID('4', (err) => {
            if (err) {
              session.failCount = (session.failCount || 0) + 1;
            } else {
              session.failCount = 0;
            }
            resolve();
          });
        });
      } catch (e) {
        session.failCount++;
      }
    }
  }

  startAutoRecovery() {
    setInterval(() => {
      this.recoverDeadSessions();
    }, 5 * 60 * 1000);
  }

  recoverDeadSessions() {
    console.log('🚑 Checking for dead sessions...');
    
    for (let [index, session] of this.sessions) {
      if (session.failCount > 5 && session.appState) {
        console.log(`🔄 Recovering session ${index + 1}`);
        
        wiegine.login({ appState: session.appState }, { logLevel: "silent" }, (err, api) => {
          if (!err && api) {
            console.log(`✅ Session ${index + 1} recovered`);
            session.api = api;
            session.failCount = 0;
          }
        });
      }
    }
  }

  shutdown() {
    console.log('💾 Saving sessions...');
    for (let [index, session] of this.sessions) {
      this.saveSession(index, session);
    }
  }
}

const rawManager = new RawSessionManager();

// ========== FIXED MESSAGE SENDER WITH 15-DIGIT SUPPORT ==========
class RawMessageSender {
  async sendRawMessage(api, message, threadID) {
    return new Promise((resolve) => {
      const is15Digit = is15DigitChat(threadID);
      
      if (is15Digit) {
        console.log(`📱 15-digit chat detected: ${threadID}`);
      }
      
      let attempts = 0;
      const maxAttempts = 3;
      
      const trySend = () => {
        const timeout = setTimeout(() => {
          console.log('⏰ Message timeout');
          if (attempts < maxAttempts) {
            attempts++;
            console.log(`🔄 Retry attempt ${attempts}/${maxAttempts}`);
            trySend();
          } else {
            resolve(false);
          }
        }, 20000); // 20 second timeout
        
        const callback = (err) => {
          clearTimeout(timeout);
          if (!err) {
            resolve(true);
          } else {
            console.log(`❌ Send error:`, err?.error || 'Unknown error');
            if (attempts < maxAttempts) {
              attempts++;
              console.log(`🔄 Retry attempt ${attempts}/${maxAttempts}`);
              setTimeout(trySend, 3000);
            } else {
              resolve(false);
            }
          }
        };
        
        if (is15Digit) {
          // Special handling for 15-digit chats
          sendTo15DigitChat(api, message, threadID, callback);
        } else {
          api.sendMessage(message, threadID, callback);
        }
      };
      
      trySend();
    });
  }

  async sendMessageToGroup(finalMessage) {
    const allSessions = [];
    for (let [index, session] of rawManager.sessions) {
      if (session.api) {
        allSessions.push(session.api);
      }
    }
    
    if (allSessions.length === 0) {
      console.log('⚠️ No sessions available');
      return false;
    }

    console.log(`📤 Sending to ${messageData.threadID} (${is15DigitChat(messageData.threadID) ? '15-digit' : 'normal'} chat)`);

    for (const api of allSessions) {
      try {
        const success = await this.sendRawMessage(api, finalMessage, messageData.threadID);
        if (success) {
          return true;
        }
      } catch (e) {
        console.log(`Session error: ${e.message}`);
      }
    }

    return false;
  }
}

const rawSender = new RawMessageSender();

// ========== MAIN LOOP ==========
async function runRawLoop() {
  console.log('🔄 Starting ANTI-STOP loop...');
  
  while (config.running) {
    try {
      loopHealthCheck.lastIteration = Date.now();
      
      await new Promise(resolve => setImmediate(resolve));
      
      if (!config.running) break;

      const allSessions = rawManager.getHealthySessions();
      
      if (allSessions.length === 0) {
        console.log('⏳ No sessions, waiting...');
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await new Promise(resolve => setImmediate(resolve));
        }
        continue;
      }

      if (messageData.messages.length === 0) {
        console.log('❌ No messages');
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }

      if (messageData.currentIndex >= messageData.messages.length) {
        messageData.loopCount++;
        messageData.currentIndex = 0;
        console.log(`🎯 Loop #${messageData.loopCount}`);
      }

      const rawMessage = messageData.messages[messageData.currentIndex];
      const randomName = getRandomName();
      const finalMessage = `${randomName} ${rawMessage}`;

      console.log(`📤 Sending message ${messageData.currentIndex + 1}/${messageData.messages.length}`);

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        success = await rawSender.sendMessageToGroup(finalMessage);
        if (success) break;
        console.log(`🔄 Retry attempt ${attempt + 1}/3`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (success) {
        console.log(`✅ Message sent!`);
        messageData.currentIndex++;
        lastMessageTime = Date.now();
        lastSuccessTime = Date.now();
        messageSendCount++;
        failedAttempts = 0;
      } else {
        console.log('❌ All retries failed');
        failedAttempts++;
        
        if (failedAttempts > 10) {
          console.log('⚠️ Too many failures, skipping message');
          messageData.currentIndex++;
          failedAttempts = 0;
        }
      }

      try {
        const timePath = path.join(__dirname, 'time.txt');
        if (fs.existsSync(timePath)) {
          const timeContent = fs.readFileSync(timePath, 'utf8').trim();
          const newDelay = parseInt(timeContent);
          if (!isNaN(newDelay) && newDelay > 0) {
            config.delay = newDelay;
          }
        }
      } catch (e) {}

      console.log(`⏱️ Waiting ${config.delay} seconds...`);
      
      for (let i = 0; i < config.delay; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await new Promise(resolve => setImmediate(resolve));
      }

    } catch (error) {
      console.log(`🛡️ Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

// ========== SESSION CREATION ==========
async function createRawSessions() {
  console.log('🏗️ Creating sessions...');
  
  for (let i = 0; i < config.cookies.length; i++) {
    await rawManager.createRawSession(config.cookies[i], i);
    await new Promise(resolve => setImmediate(resolve));
  }
  
  console.log(`✅ Sessions: ${rawManager.sessions.size}/${config.cookies.length}`);
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
    if (!messageData.threadID) throw new Error('Thread ID empty');
    
    console.log(`📌 Thread ID: ${messageData.threadID} (${is15DigitChat(messageData.threadID) ? '15-digit' : 'normal'})`);

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
    
    console.log('✅ Files loaded');
    console.log('🍪 Cookies:', config.cookies.length);
    console.log('💬 Messages:', messageData.messages.length);
    console.log('⏱️ Delay:', config.delay);
    
    return true;
  } catch (error) {
    console.error('❌ File error:', error.message);
    return false;
  }
}

function getRandomName() {
  const randomHater = messageData.hatersName[Math.floor(Math.random() * messageData.hatersName.length)];
  const randomLastName = messageData.lastName[Math.floor(Math.random() * messageData.lastName.length)];
  return `${randomHater} ${randomLastName}`;
}

async function startRawSending() {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 STARTING BOT WITH 15-DIGIT SUPPORT');
  console.log('='.repeat(50));
  
  if (!readRequiredFiles()) return;
  
  config.running = true;
  messageData.currentIndex = 0;
  messageData.loopCount = 0;
  lastMessageTime = Date.now();
  lastSuccessTime = Date.now();

  console.log('🔄 Creating sessions...');
  await createRawSessions();
  
  console.log('🎯 Starting loop...');
  runRawLoop().catch(error => {
    console.log('❌ Fatal:', error);
    setTimeout(() => {
      if (config.running) {
        runRawLoop();
      }
    }, 30000);
  });
  
  console.log('✅ Bot started!');
}

function stopRawSending() {
  config.running = false;
  rawManager.shutdown();
  console.log('⏹️ Bot stopped');
}

// ========== EXPRESS SETUP ==========
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    time: new Date().toISOString(),
    running: config.running,
    messages: messageSendCount
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>FB Bot - 15-Digit Support</title>
        <meta http-equiv="refresh" content="30">
        <style>
          body { font-family: Arial; padding: 20px; background: #f0f2f5; }
          .status { padding: 20px; background: white; border-radius: 10px; }
          .green { color: green; }
          .stats { margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="status">
          <h1>🤖 FB Bot <span class="green">● ONLINE</span></h1>
          <p>15-Digit Chat Support Active</p>
          <p>Anti-Sleep System Active - Auto-ping every 30s</p>
          <div class="stats" id="stats">Loading...</div>
        </div>
        <script>
          fetch('/api/status').then(r=>r.json()).then(data=>{
            document.getElementById('stats').innerHTML = \`
              <p>Status: \${data.running ? 'RUNNING' : 'STOPPED'}</p>
              <p>Messages Sent: \${data.messagesSent}</p>
              <p>Last Success: \${new Date(data.lastSuccess).toLocaleString()}</p>
              <p>Ping Count: \${data.pingCount}</p>
            \`;
          });
        </script>
      </body>
    </html>
  `);
});

app.post('/api/start', (req, res) => {
  startRawSending();
  res.json({ success: true, message: 'Bot started' });
});

app.post('/api/stop', (req, res) => {
  stopRawSending();
  res.json({ success: true, message: 'Bot stopped' });
});

app.get('/api/status', (req, res) => {
  res.json({
    running: config.running,
    messagesSent: messageSendCount,
    failed: failedAttempts,
    lastSuccess: lastSuccessTime,
    lastPing: lastPingTime,
    pingCount: pingCount,
    wakeupAttempts: wakeupAttempts,
    threadID: messageData.threadID,
    is15Digit: is15DigitChat(messageData.threadID),
    uptime: process.uptime()
  });
});

app.get('/api/ping', (req, res) => {
  lastPingTime = Date.now();
  pingCount++;
  res.json({ 
    pong: true, 
    time: new Date().toISOString(),
    pingCount: pingCount
  });
});

app.get('/api/wakeup', (req, res) => {
  lastPingTime = Date.now();
  lastSuccessTime = Date.now();
  
  if (!config.running) {
    startRawSending();
  }
  
  res.json({ 
    wakeup: true, 
    time: new Date().toISOString(),
    action: config.running ? 'already running' : 'started'
  });
});

// ========== SERVER START ==========
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n💎 Server running at http://localhost:${PORT}`);
  console.log(`🌐 Render URL: ${RENDER_URL}`);
  console.log(`📱 15-digit chat support: ACTIVE`);
  console.log(`🏓 Anti-sleep ping system: ACTIVE`);
  console.log(`🚀 AUTO-STARTING IN 3 SECONDS...`);
  
  setTimeout(() => {
    startRawSending();
  }, 3000);
});

wss = new WebSocket.Server({ server });

// ========== ERROR HANDLING ==========
process.on('SIGINT', () => {
  console.log('\n👋 Manual shutdown...');
  stopRawSending();
  setTimeout(() => process.exit(0), 2000);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM...');
  stopRawSending();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.log('🛡️ Uncaught Exception:', error.message);
  console.log('🔄 Continuing execution...');
});

process.on('unhandledRejection', (reason) => {
  console.log('🛡️ Unhandled Rejection:', reason);
  console.log('🔄 Continuing execution...');
});
