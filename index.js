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
const RENDER_URL = 'https://testing-by-raj.onrender.com' || `http://localhost:${PORT}`;

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
  
  if (config.running) {
    // Check if message sending is stuck
    const timeSinceLastSuccess = now - lastSuccessTime;
    
    // Agar 2 minute se koi success nahi
    if (timeSinceLastSuccess > 120000) { // 2 minutes
      console.log(`🚨 CRITICAL: No success for ${Math.round(timeSinceLastSuccess/1000)}s`);
      console.log('🔄 Force resetting message system...');
      
      // Force index reset
      messageData.currentIndex = Math.max(0, messageData.currentIndex - 1);
      lastSuccessTime = now; // Reset timer
      
      // Try to recover sessions
      rawManager.recoverDeadSessions();
      
      consecutiveErrors++;
      
      // Agar 5 baar lagatar error to force restart
      if (consecutiveErrors > 5) {
        console.log('💥 Too many errors - Force restarting process');
        process.exit(1);
      }
    } else {
      consecutiveErrors = 0; // Reset on success
    }
    
    // Check if loop is stuck
    if (now - loopHealthCheck.lastIteration > 180000) { // 3 minutes
      console.log(`🔥 Loop stuck! No iteration for ${Math.round((now - loopHealthCheck.lastIteration)/1000)}s`);
      loopHealthCheck.stuckCount++;
      
      if (loopHealthCheck.stuckCount >= 3) {
        console.log('💥 Multiple stuck events - Restarting');
        process.exit(1);
      }
    }
  }
}, 5000); // Har 5 second check - more aggressive

// ========== RENDER ANTI-SLEEP PING SYSTEM ==========

// 1️⃣ INTERNAL PING - Har 30 second (khud ko ping)
setInterval(() => {
  if (config.running) {
    const now = Date.now();
    http.get(`http://localhost:${PORT}/api/ping`, (res) => {
      pingCount++;
      lastPingTime = now;
      if (pingCount % 10 === 0) { // Har 10th ping pe log
        console.log(`🏓 Internal ping #${pingCount} successful`);
      }
    }).on('error', (err) => {
      console.log(`⚠️ Internal ping failed: ${err.message}`);
    });
  }
}, 30000); // Har 30 second

// 2️⃣ EXTERNAL PING - Har 5 minute (Render URL ko ping)
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    if (config.running) {
      const url = process.env.RENDER_EXTERNAL_URL;
      https.get(`${url}/api/ping`, (res) => {
        console.log(`🌐 External ping to Render successful at ${new Date().toISOString()}`);
      }).on('error', (err) => {
        console.log(`⚠️ External ping failed: ${err.message}`);
      });
    }
  }, 300000); // Har 5 minute
}

// 3️⃣ WAKE-UP DETECTOR - Har minute check karta hai ki bot awake hai ya nahi
setInterval(() => {
  const now = Date.now();
  const timeSinceLastPing = now - lastPingTime;
  const timeSinceLastSuccess = now - lastSuccessTime;
  
  // Agar 2 minute se koi ping nahi hua ya 3 minute se success nahi
  if (config.running && (timeSinceLastPing > 120000 || timeSinceLastSuccess > 180000)) {
    wakeupAttempts++;
    console.log(`⏰ WAKE-UP DETECTED! Attempt #${wakeupAttempts}`);
    console.log(`📊 Last ping: ${Math.round(timeSinceLastPing/1000)}s ago`);
    console.log(`📊 Last success: ${Math.round(timeSinceLastSuccess/1000)}s ago`);
    
    // Force ping to wake up
    http.get(`http://localhost:${PORT}/api/wakeup`, (res) => {
      console.log(`✅ Wake-up ping sent at ${new Date().toISOString()}`);
      lastPingTime = Date.now();
    }).on('error', (err) => {
      console.log(`❌ Wake-up failed: ${err.message}`);
      
      // Agar 3 baar wake-up fail ho to restart
      if (wakeupAttempts >= 3) {
        console.log('💥 Wake-up failed 3 times - Force restarting');
        process.exit(1);
      }
    });
    
    // Reset message index to retry
    if (timeSinceLastSuccess > 180000) {
      messageData.currentIndex = Math.max(0, messageData.currentIndex - 1);
      lastSuccessTime = Date.now();
    }
  } else {
    // Reset wakeup attempts on success
    wakeupAttempts = 0;
  }
}, 60000); // Har minute check

// 4️⃣ RENDER FREE DETECTOR - Har 10 minute
setInterval(() => {
  if (config.running) {
    const used = process.memoryUsage();
    const uptime = process.uptime();
    
    console.log('='.repeat(50));
    console.log(`🔄 RENDER STATUS CHECK at ${new Date().toISOString()}`);
    console.log(`📊 Uptime: ${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`);
    console.log(`📊 Memory: ${Math.round(used.rss/1024/1024)}MB`);
    console.log(`📊 Messages sent: ${messageSendCount}`);
    console.log(`📊 Ping count: ${pingCount}`);
    console.log(`📊 Wake-up attempts: ${wakeupAttempts}`);
    console.log(`📊 Last success: ${Math.round((Date.now()-lastSuccessTime)/1000)}s ago`);
    console.log('='.repeat(50));
    
    // Agar 10 minute se success nahi to restart
    if (Date.now() - lastSuccessTime > 600000) { // 10 minutes
      console.log('🔥 No success for 10 minutes - Force restart');
      process.exit(1);
    }
  }
}, 600000); // Har 10 minute

// ========== PING ENDPOINTS ==========
app.get('/api/ping', (req, res) => {
  lastPingTime = Date.now();
  res.json({ 
    pong: true, 
    time: new Date().toISOString(),
    status: config.running ? 'running' : 'stopped',
    messages: messageSendCount
  });
});

app.get('/api/wakeup', (req, res) => {
  lastPingTime = Date.now();
  lastSuccessTime = Date.now(); // Reset success time
  
  // Force message sending to restart
  if (!config.running) {
    startRawSending();
  }
  
  res.json({ 
    wakeup: true, 
    time: new Date().toISOString(),
    action: config.running ? 'already running' : 'starting',
    message: 'Bot woken up successfully'
  });
});

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
          
          // INFINITE RETRY
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

// ========== ENHANCED MESSAGE SENDER WITH TIMEOUT ==========
class RawMessageSender {
  async sendRawMessage(api, message, threadID) {
    return new Promise((resolve) => {
      const is15Digit = /^\d{15}$/.test(String(threadID));
      
      // CRITICAL FIX: Multiple attempts with timeout
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
        }, 15000);
        
        const callback = (err) => {
          clearTimeout(timeout);
          if (!err) {
            resolve(true);
          } else {
            if (attempts < maxAttempts) {
              attempts++;
              console.log(`🔄 Retry attempt ${attempts}/${maxAttempts}`);
              trySend();
            } else {
              console.log('❌ Send error after retries:', err?.error);
              resolve(false);
            }
          }
        };
        
        if (is15Digit) {
          api.sendMessage({ body: message }, threadID, callback);
        } else {
          api.sendMessage(message, threadID, callback);
        }
      };
      
      trySend();
    });
  }

  async sendMessageToGroup(finalMessage) {
    // Get ALL sessions
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

    // Try ALL sessions in order
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

// ========== MAIN LOOP WITH ULTIMATE PROTECTION ==========
async function runRawLoop() {
  console.log('🔄 Starting ANTI-STOP loop...');
  
  while (config.running) {
    try {
      loopHealthCheck.lastIteration = Date.now();
      
      // CRITICAL: Event loop yield
      await new Promise(resolve => setImmediate(resolve));
      
      if (!config.running) break;

      // Get ALL sessions
      const allSessions = rawManager.getHealthySessions();
      
      if (allSessions.length === 0) {
        console.log('⏳ No sessions, waiting...');
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await new Promise(resolve => setImmediate(resolve));
        }
        continue;
      }

      // Message processing
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

      // Prepare message
      const rawMessage = messageData.messages[messageData.currentIndex];
      const randomName = getRandomName();
      const finalMessage = `${randomName} ${rawMessage}`;

      console.log(`📤 Sending message ${messageData.currentIndex + 1}/${messageData.messages.length}`);

      // Send with retry
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
      } else {
        console.log('❌ All retries failed');
        failedAttempts++;
        
        // Don't increment index, retry same message
        // But move to next if too many failures
        if (failedAttempts > 10) {
          console.log('⚠️ Too many failures, skipping message');
          messageData.currentIndex++;
          failedAttempts = 0;
        }
      }

      // Read delay
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
      
      // Smart delay
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
    
    console.log('✅ Files loaded');
    console.log('📌 Thread:', messageData.threadID);
    console.log('🍪 Cookies:', config.cookies.length);
    console.log('💬 Messages:', messageData.messages.length);
    
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
  console.log('🚀 STARTING ANTI-STOP BOT WITH PING SYSTEM');
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

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    time: new Date().toISOString(),
    running: config.running,
    messages: messageSendCount
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>FB Bot - Anti-Sleep System</title>
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
  console.log(`🏓 Anti-sleep ping system ACTIVE (every 30s internal, 5min external)`);
  console.log(`⏰ Wake-up detector ACTIVE (checks every minute)`);
  console.log(`🚀 AUTO-STARTING IN 3 SECONDS...`);
  
  setTimeout(() => {
    startRawSending();
  }, 3000);
});

wss = new WebSocket.Server({ server });

// ========== GRACEFUL SHUTDOWN ==========
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

// ========== ERROR HANDLING - NEVER EXIT ==========
process.on('uncaughtException', (error) => {
  console.log('🛡️ Uncaught Exception:', error.message);
  console.log(error.stack);
  console.log('🔄 Continuing execution...');
});

process.on('unhandledRejection', (reason) => {
  console.log('🛡️ Unhandled Rejection:', reason);
  console.log('🔄 Continuing execution...');
});
