const fs = require('fs');
const path = require('path');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 4000;

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

// Session directory for persistence
const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

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

class RawSessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionQueue = [];
    this.sessionFile = path.join(SESSION_DIR, 'sessions.json');
    this.loadSessions();
    this.startHeartbeat();
    this.startMemoryCleanup();
    this.startCookieRefreshTimer();
    this.startAutoRecovery(); // Naya: Auto recovery har 5 minute
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
          
          // INFINITE RETRY - kabhi nahi rukega
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
      if (session.healthy) {
        healthy.push(session.api);
      }
    }
    return healthy;
  }

  // ==================== INFINITE HEARTBEAT ====================
  startHeartbeat() {
    setInterval(() => {
      this.checkSessionsHealth();
    }, 5 * 60 * 1000); // Har 5 minute, kabhi band nahi hoga
  }

  async checkSessionsHealth() {
    console.log('💓 Running heartbeat check...');
    
    for (let [index, session] of this.sessions) {
      if (!session.api) {
        session.healthy = false;
        continue;
      }

      session.api.getUserID('4', (err) => {
        if (err) {
          console.log(`💔 Session ${index + 1} heartbeat failed`);
          session.healthy = false;
          session.failCount = (session.failCount || 0) + 1;
          session.lastUsed = Date.now();
          
          // Try to refresh this session
          this.refreshSessionCookie(index);
        } else {
          session.healthy = true;
          session.failCount = 0;
          session.lastUsed = Date.now();
        }
      });
    }
  }

  // ==================== MEMORY CLEANUP ====================
  startMemoryCleanup() {
    setInterval(() => {
      this.cleanupMemory();
    }, 30 * 60 * 1000); // Har 30 minute
  }

  cleanupMemory() {
    console.log('🧹 Running memory cleanup...');
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    
    for (let [index, session] of this.sessions) {
      // Sirf unhealthy aur purane sessions hatao
      if (!session.healthy && (now - session.lastUsed) > ONE_HOUR && session.failCount > 5) {
        console.log(`🗑️ Removing stale session ${index + 1}`);
        this.sessions.delete(index);
        this.sessionQueue = this.sessionQueue.filter(i => i !== index);
      }
      
      // API object null karo agar unhealthy ho
      if (session.api && !session.healthy && session.failCount > 10) {
        session.api = null;
      }
    }

    // Memory usage log
    const used = process.memoryUsage();
    console.log(`📊 Memory: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
  }

  // ==================== COOKIE REFRESH ====================
  startCookieRefreshTimer() {
    setInterval(() => {
      this.refreshAllCookies();
    }, 24 * 60 * 60 * 1000); // Har 24 ghante
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

  // ==================== AUTO RECOVERY ====================
  startAutoRecovery() {
    setInterval(() => {
      this.recoverDeadSessions();
    }, 5 * 60 * 1000); // Har 5 minute recovery check
  }

  recoverDeadSessions() {
    console.log('🚑 Checking for dead sessions to recover...');
    
    for (let [index, session] of this.sessions) {
      // Agar session dead hai but appState hai to recover karo
      if (!session.healthy && session.appState && session.failCount > 3) {
        console.log(`🔄 Attempting to recover session ${index + 1}`);
        
        wiegine.login({ appState: session.appState }, { logLevel: "silent" }, (err, api) => {
          if (!err && api) {
            console.log(`✅ Session ${index + 1} recovered successfully`);
            session.api = api;
            session.healthy = true;
            session.failCount = 0;
            session.lastUsed = Date.now();
            
            // Test group access
            this.testGroupAccess(api, index);
          } else {
            console.log(`❌ Session ${index + 1} recovery failed`);
          }
        });
      }
    }
  }

  // Create new session if index doesn't exist
  async ensureSession(index, cookie) {
    if (!this.sessions.has(index)) {
      console.log(`🆕 Creating missing session ${index + 1}`);
      await this.createRawSession(cookie, index);
    }
    return this.sessions.get(index);
  }

  // Shutdown (sirf manual band karne ke liye)
  shutdown() {
    console.log('💾 Saving sessions before shutdown...');
    for (let [index, session] of this.sessions) {
      this.saveSession(index, session);
    }
  }
}

const rawManager = new RawSessionManager();

class RawMessageSender {
  async sendRawMessage(api, message, threadID) {
    return new Promise((resolve) => {
      const is15Digit = is15DigitChat(threadID);
      
      if (is15Digit) {
        sendTo15DigitChat(api, message, threadID, (err) => {
          if (!err) {
            resolve(true);
            return;
          }
          console.log('❌ Send error:', err?.error || 'Unknown error');
          resolve(false);
        });
      } else {
        api.sendMessage(message, threadID, (err) => {
          if (!err) {
            resolve(true);
            return;
          }
          console.log('❌ Send error:', err?.error || 'Unknown error');
          resolve(false);
        });
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
      
      // 5 second wait for recovery
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Dobara check karo
      healthySessions = rawManager.getHealthySessions();
      
      if (healthySessions.length === 0) {
        console.log('❌ Still no healthy sessions');
        return false;
      }
    }

    // Har session se try karo
    for (const api of healthySessions) {
      const success = await this.sendRawMessage(api, finalMessage, messageData.threadID);
      if (success) {
        return true;
      }
    }

    return false;
  }
}

const rawSender = new RawMessageSender();

// ==================== INFINITE LOOP ====================
async function runRawLoop() {
  // Ye loop kabhi automatically band nahi hoga
  // Sirf tab band hoga jab aap manually /api/stop karo
  
  while (config.running) {
    try {
      // Check if we have any healthy sessions
      let healthySessions = rawManager.getHealthySessions();
      
      // Agar koi healthy nahi to recovery karo
      if (healthySessions.length === 0) {
        console.log('🔄 No healthy sessions, running recovery...');
        rawManager.recoverDeadSessions();
        
        // Wait for recovery
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Check again
        healthySessions = rawManager.getHealthySessions();
        
        // Agar still no sessions to continue loop but wait
        if (healthySessions.length === 0) {
          console.log('⏳ Waiting for sessions to become available...');
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue; // Loop continue, band nahi hoga
        }
      }

      // Message processing
      if (messageData.messages.length === 0) {
        console.log('❌ No messages to send');
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }

      if (messageData.currentIndex >= messageData.messages.length) {
        messageData.loopCount++;
        messageData.currentIndex = 0;
        console.log(`🎯 Loop #${messageData.loopCount} completed, starting new loop`);
      }

      const rawMessage = messageData.messages[messageData.currentIndex];
      const randomName = getRandomName();
      const finalMessage = `${randomName} ${rawMessage}`;

      console.log(`📤 Sending message ${messageData.currentIndex + 1}/${messageData.messages.length}`);

      const success = await rawSender.sendMessageToGroup(finalMessage);

      if (success) {
        console.log(`✅ Message ${messageData.currentIndex + 1} sent successfully`);
        messageData.currentIndex++;
      } else {
        console.log('❌ Message failed, will retry same message');
        // Don't increment index, retry same message
      }

      // Read delay from time.txt
      const timePath = path.join(__dirname, 'time.txt');
      if (fs.existsSync(timePath)) {
        const timeContent = fs.readFileSync(timePath, 'utf8').trim();
        config.delay = parseInt(timeContent) || 10;
      }

      console.log(`⏱️ Waiting ${config.delay} seconds...`);
      await new Promise(resolve => setTimeout(resolve, config.delay * 1000));

    } catch (error) {
      console.log(`🛡️ Loop error: ${error.message} - Continuing...`);
      // Error aaya to 10 second wait karo phir continue
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log('⏹️ Loop stopped (manual stop)');
}

async function createRawSessions() {
  console.log('🏗️ Creating sessions...');
  
  for (let i = 0; i < config.cookies.length; i++) {
    await rawManager.createRawSession(config.cookies[i], i);
  }
  
  const healthyCount = rawManager.getHealthySessions().length;
  console.log(`✅ ${healthyCount}/${config.cookies.length} sessions healthy`);
}

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
    console.log('🔄 Mode: INFINITE LOOP (never auto-stop)');
    
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
  console.log('🚀 Starting message system (INFINITE MODE)...');
  
  if (!readRequiredFiles()) return;
  config.running = true;
  messageData.currentIndex = 0;
  messageData.loopCount = 0;

  console.log('🔄 Creating sessions...');
  await createRawSessions();
  
  const healthyCount = rawManager.getHealthySessions().length;
  if (healthyCount > 0) {
    console.log(`🎯 Starting infinite loop with ${healthyCount} healthy sessions`);
    // Run loop without await so it doesn't block
    runRawLoop().catch(error => {
      console.log('❌ Fatal loop error:', error);
      // Agar fatal error aaya to 1 minute wait karo phir restart
      setTimeout(() => {
        if (config.running) {
          console.log('🔄 Restarting loop...');
          runRawLoop();
        }
      }, 60000);
    });
  } else {
    console.log('⚠️ No healthy sessions, but will keep trying...');
    // Agar koi session nahi to bhi loop chalao, wapas try karega
    runRawLoop();
  }
}

function stopRawSending() {
  config.running = false;
  rawManager.shutdown();
  console.log('⏹️ System stopped (manual stop)');
}

// Express setup
app.use(express.json());

app.post('/api/start', (req, res) => {
  startRawSending();
  res.json({ success: true, message: 'System started in INFINITE mode' });
});

app.post('/api/stop', (req, res) => {
  stopRawSending();
  res.json({ success: true, message: 'System stopped' });
});

app.get('/api/status', (req, res) => {
  const healthyCount = rawManager.getHealthySessions().length;
  const used = process.memoryUsage();
  
  res.json({
    running: config.running,
    mode: 'INFINITE',
    currentIndex: messageData.currentIndex,
    totalMessages: messageData.messages.length,
    loopCount: messageData.loopCount,
    healthySessions: healthyCount,
    totalCookies: config.cookies.length,
    delay: config.delay,
    memory: {
      rss: Math.round(used.rss / 1024 / 1024),
      heapUsed: Math.round(used.heapUsed / 1024 / 1024)
    },
    uptime: Math.floor(process.uptime() / 3600) + 'h ' + 
             Math.floor((process.uptime() % 3600) / 60) + 'm',
    message: 'Running forever until manual stop'
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Facebook Bot - INFINITE MODE</title>
        <style>
          body { font-family: Arial; padding: 20px; background: #f0f2f5; }
          button { padding: 10px 20px; margin: 5px; font-size: 16px; cursor: pointer; }
          #status { margin-top: 20px; padding: 10px; background: white; border-radius: 5px; }
          .infinite { color: green; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Facebook Bot <span class="infinite">(INFINITE MODE)</span></h1>
        <p>Running forever until manually stopped</p>
        <button onclick="start()">Start</button>
        <button onclick="stop()">Stop</button>
        <button onclick="getStatus()">Status</button>
        <div id="status"></div>
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
            document.getElementById('status').innerHTML = 
              '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
          }
          setInterval(getStatus, 5000);
        </script>
      </body>
    </html>
  `);
});

const server = app.listen(PORT, () => {
  console.log(`\n💎 Server running at http://localhost:${PORT}`);
  console.log(`🚀 INFINITE MODE - Will run forever until manual stop`);
  console.log(`🔄 AUTO-STARTING IN 3 SECONDS...`);
  
  setTimeout(() => {
    startRawSending();
  }, 3000);
});

wss = new WebSocket.Server({ server });

// Graceful shutdown (sirf manual band karne ke liye)
process.on('SIGINT', () => {
  console.log('\n👋 Manual shutdown initiated...');
  stopRawSending();
  setTimeout(() => {
    console.log('👋 Goodbye!');
    process.exit(0);
  }, 2000);
});

// Uncaught exceptions ko bhi handle karo but band mat karo
process.on('uncaughtException', (error) => {
  console.log('🛡️ Uncaught Exception:', error.message);
  console.log('🔄 Continuing execution...');
  // Band nahi hoga, continue karega
});

process.on('unhandledRejection', (reason) => {
  console.log('🛡️ Unhandled Rejection:', reason);
  console.log('🔄 Continuing execution...');
  // Band nahi hoga, continue karega
});
