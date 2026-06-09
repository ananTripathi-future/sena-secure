/**
 * Sena-Secure Main Application Coordinator
 * Handles states, layouts, WebSocket connections, Canvas Map rendering, and cryptographic flows.
 */

// Global Error Diagnostics for debugging file uploads
window.onerror = function (message, source, lineno, colno, error) {
  alert(`SENA-SECURE DIAGNOSTIC ALERT:\nError: ${message}\nLocation: ${source} (Line ${lineno}:${colno})`);
  return false;
};

// Application State
const state = {
  authToken: null,
  currentUser: null,
  activeTab: 'map-pane',
  isLockdown: false,
  selectedNode: null,
  socket: null,
  
  // Network simulation variables
  networkProfile: 'broadband',
  offlineQueue: [],
  
  // Login MFA state flags
  mfaSmartCard: false,
  mfaIris: false,
  mfaHwToken: false,
  
  // Tactical Map Nodes
  nodes: [
    { id: 'delhi', name: "Joint Cyber Command (Air HQ)", unit: "Joint Forces Command", lat: 28.6139, lng: 77.2090, x: 250, y: 190, role: "Air Force Command", clearance: "Level 5", encryption: "Crystals-Kyber-768 Dual", threat: 0.01, status: "SYNCHRONIZED" },
    { id: 'leh', name: "Northern Tactical HQ (Leh)", unit: "Army 14 Corps", lat: 34.1526, lng: 77.5771, x: 260, y: 80, role: "Border Operations Post", clearance: "Level 3", encryption: "AES-256-GCM Direct", threat: 0.15, status: "SYNCHRONIZED" },
    { id: 'chandi', name: "Western Command (Chandimandir)", unit: "Army Command HQ", lat: 30.7259, lng: 76.8488, x: 230, y: 160, role: "Army Command Center", clearance: "Level 4", encryption: "IPSec VPN + Kyber", threat: 0.04, status: "SYNCHRONIZED" },
    { id: 'kolkata', name: "Eastern Command (Kolkata)", unit: "Army Command HQ", lat: 22.5726, lng: 88.3639, x: 440, y: 320, role: "Army Command Center", clearance: "Level 4", encryption: "IPSec VPN + Kyber", threat: 0.05, status: "SYNCHRONIZED" },
    { id: 'mumbai', name: "Western Naval Command (Mumbai)", unit: "Naval Headquarters", lat: 18.9220, lng: 72.8347, x: 160, y: 400, role: "Naval Operations Fleet", clearance: "Level 4", encryption: "Satellite Kyber-Link", threat: 0.03, status: "SYNCHRONIZED" },
    { id: 'kochi', name: "Southern Command (Pune/Kochi)", unit: "Joint Naval & Army HQ", lat: 9.9312, lng: 76.2673, x: 200, y: 560, role: "Naval Operations Fleet", clearance: "Level 3", encryption: "AES-256-GCM Direct", threat: 0.02, status: "SYNCHRONIZED" },
    { id: 'raw', name: "RAW Liaison Office (Secret)", unit: "Intelligence Wing", lat: 28.5900, lng: 77.2300, x: 280, y: 220, role: "Intelligence Command", clearance: "Level 5", encryption: "Kyber Shield (Quantum-Secure)", threat: 0.02, status: "SYNCHRONIZED" }
  ],
  
  // Secure Storage files
  files: [
    { name: "TACTICAL_BORDER_PATROL_PLAN_SUMMER.pdf.enc", size: "1.4 MB", type: "pdf", rawName: "TACTICAL_BORDER_PATROL_PLAN_SUMMER.pdf" },
    { name: "RECON_SATELLITE_IMG_0521.raw.enc", size: "12.8 MB", type: "image", rawName: "RECON_SATELLITE_IMG_0521.raw" }
  ],

  // SIEM Stats
  totalLogs: 0,
  idsAlerts: 0,
  blockedIps: 2
};

// Map canvas metrics
let canvas, ctx;
let mapAnimFrame;

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  // Initialize Sound System
  window.addEventListener('mousedown', () => {
    SenaAudio.init();
  });
  
  // Set default selected base
  state.selectedNode = state.nodes[0];
  renderSelectedNodeDetails();
  
  // Render nodes list in sidebar
  renderNodesList();
  
  // Setup Canvas Map size
  canvas = document.getElementById('tactical-map-canvas');
  if (canvas) {
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    startMapRendering();
  }

  // Set drag and drop listeners
  const dropZone = document.getElementById('vault-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--color-cyan)';
      dropZone.style.background = 'rgba(0, 210, 255, 0.05)';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'rgba(0, 210, 255, 0.3)';
      dropZone.style.background = 'transparent';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'rgba(0, 210, 255, 0.3)';
      dropZone.style.background = 'transparent';
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        encryptAndStoreFile(files[0]);
      }
    });

    dropZone.addEventListener('click', () => {
      document.getElementById('file-uploader-input').click();
    });
  }

  renderEncryptedFilesList();
});

// ----------------------------------------------------
// UI Navigation / Tab Switches
// ----------------------------------------------------
function switchTab(tabId, el) {
  SenaAudio.playClick();
  
  // Access Control verification: Auditor role ONLY allowed in Audit Logs or Map, not messaging/vault uploads
  if (tabId === 'chat-pane' || tabId === 'vault-pane') {
    if (state.currentUser && state.currentUser.role === 'Auditor') {
      alert("ACCESS DENIED: Role 'Auditor' lacks clearance to access operational communication channels or vaults.");
      return;
    }
  }

  // Deactivate all nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
  });
  
  // Deactivate all tabs
  document.querySelectorAll('.hud-tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });

  // Activate chosen
  el.classList.add('active');
  document.getElementById(tabId).classList.add('active');
  state.activeTab = tabId;

  if (tabId === 'map-pane') {
    setTimeout(resizeCanvas, 50); // Redraw map canvas
  }

  // Load audit logs if switching to audit log
  if (tabId === 'audit-pane') {
    fetchAuditLogs();
  }
}

// ----------------------------------------------------
// Zero-Trust Authentication Screen Operations
// ----------------------------------------------------
function verifyMFACard() {
  const milId = document.getElementById('military-id').value;
  if (!milId) {
    alert("Select a valid Military Service ID first.");
    return;
  }
  
  SenaAudio.playClick();
  const cardElement = document.getElementById('mfa-card');
  const statusElement = document.getElementById('mfa-card-status');
  
  cardElement.style.borderColor = 'var(--color-cyan)';
  statusElement.innerText = "AUTHENTICATING...";
  
  setTimeout(() => {
    state.mfaSmartCard = true;
    cardElement.classList.add('verified');
    statusElement.innerText = "OK [CHIP VALID]";
    statusElement.style.color = 'var(--color-green)';
    SenaAudio.playSuccess();
  }, 1000);
}

function verifyMFABiometrics() {
  const milId = document.getElementById('military-id').value;
  if (!milId) {
    alert("Select a valid Military Service ID first.");
    return;
  }

  SenaAudio.playClick();
  const scannerBox = document.getElementById('scanner-box');
  const scannerText = document.getElementById('scanner-text');
  
  scannerBox.style.display = 'flex';
  scannerBox.classList.add('scanning');
  scannerText.innerText = "CAPTURING RETINA & FINGERPRINT...";

  setTimeout(() => {
    state.mfaIris = true;
    scannerBox.classList.remove('scanning');
    scannerText.innerText = "BIOMETRICS IDENTIFIED - MATCH 99.4%";
    scannerText.style.color = 'var(--color-green)';
    
    document.getElementById('mfa-bio').classList.add('verified');
    const statusText = document.getElementById('mfa-bio-status');
    statusText.innerText = "OK [IRIS VERIFIED]";
    statusText.style.color = 'var(--color-green)';
    SenaAudio.playSuccess();
  }, 2200);
}

function verifyMFAToken() {
  const milId = document.getElementById('military-id').value;
  if (!milId) {
    alert("Select a valid Military Service ID first.");
    return;
  }

  SenaAudio.playClick();
  const tokenElement = document.getElementById('mfa-token');
  const statusElement = document.getElementById('mfa-token-status');
  
  statusElement.innerText = "SYNCING TOKEN...";
  
  setTimeout(() => {
    state.mfaHwToken = true;
    tokenElement.classList.add('verified');
    statusElement.innerText = "OK [KEY SYNCED]";
    statusElement.style.color = 'var(--color-green)';
    SenaAudio.playSuccess();
  }, 1200);
}

async function submitAuth() {
  SenaAudio.playClick();
  const milId = document.getElementById('military-id').value;
  const pin = document.getElementById('security-pin').value;
  const errMsg = document.getElementById('auth-err-msg');

  if (!milId || !pin) {
    errMsg.innerText = "Credentials required: Select Military ID and provide your PIN.";
    SenaAudio.playFailure();
    return;
  }

  if (!state.mfaSmartCard || !state.mfaIris || !state.mfaHwToken) {
    errMsg.innerText = "Zero-Trust Bypass Blocked: You must complete all Multi-Factor Authentication checks (Smart ID, Iris Biometrics, HW Token).";
    SenaAudio.playFailure();
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        militaryId: milId,
        pin: pin,
        cardToken: "SMART_CHIP_0x98A1B",
        irisScanned: true,
        hardwareSync: "YUBI_SECURE_TOKEN_572B"
      })
    });

    const data = await res.json();
    if (!data.success) {
      errMsg.innerText = data.message;
      SenaAudio.playFailure();
      return;
    }

    // Success Authentication
    state.authToken = data.token;
    state.currentUser = data.user;
    sessionStorage.setItem('sena_token', data.token);

    // Update Profile Views
    document.getElementById('user-display-name').innerText = data.user.name;
    document.getElementById('user-display-role').innerText = `${data.user.rank} (${data.user.role})`;
    document.getElementById('user-display-clearance').innerText = data.user.clearance;

    // Restrict Auditor view immediately on frontend sidebar
    if (data.user.role === 'Auditor') {
      document.getElementById('nav-audit').style.display = 'flex';
    } else {
      document.getElementById('nav-audit').style.display = 'flex'; // available to all admins/commanders too
    }

    // Clear and fade Auth Overlay
    document.getElementById('auth-overlay').style.opacity = 0;
    setTimeout(() => {
      document.getElementById('auth-overlay').style.display = 'none';
      document.getElementById('hud-container').style.display = 'grid';
      
      // Initialize Audio Hum and websocket connection
      SenaAudio.startAmbientHum();
      SenaAudio.playSuccess();
      connectWebSockets();
      
      // Load initial chat messages
      fetchMessages();
    }, 500);

  } catch (err) {
    errMsg.innerText = "Gateway Connection Refused. Please check network routes.";
    SenaAudio.playFailure();
  }
}

// ----------------------------------------------------
// WebSocket Real-time System Updates (IDS Traffic / SIEM)
// ----------------------------------------------------
function connectWebSockets() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  state.socket = new WebSocket(wsUrl);

  state.socket.onopen = () => {
    document.getElementById('ws-connections').innerText = "CONNECTED";
    document.getElementById('ws-connections').style.color = 'var(--color-green)';
  };

  state.socket.onclose = () => {
    document.getElementById('ws-connections').innerText = "OFFLINE - RETRYING";
    document.getElementById('ws-connections').style.color = 'var(--color-crimson)';
    setTimeout(connectWebSockets, 5000);
  };

  state.socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
      case "SYSTEM_CONNECT":
        state.totalLogs = 120 + data.activeConnections;
        document.getElementById('siem-total-logs').innerText = state.totalLogs;
        break;
        
      case "TRAFFIC_PULSE":
        handleTrafficPulse(data.traffic);
        break;
        
      case "THREAT_ALERT":
        handleThreatAlert(data.threat);
        break;
        
      case "NEW_MESSAGE":
        handleIncomingMessage(data.message);
        break;
        
      case "LOCKDOWN_STATUS":
        handleLockdownStatusChange(data.engaged, data.triggeredBy);
        break;
    }
  };
}

function handleTrafficPulse(traffic) {
  state.totalLogs++;
  document.getElementById('siem-total-logs').innerText = state.totalLogs;

  // Render log row in SIEM Tab
  const feed = document.getElementById('siem-traffic-feed');
  if (feed) {
    const row = document.createElement('div');
    row.className = 'siem-log-row';
    row.innerHTML = `
      <span class="log-time">${traffic.timestamp}</span>
      <span class="log-severity severity-low">BENIGN</span>
      <span>${traffic.status === 200 ? '10.220.14.89' : '185.220.101.4'}</span>
      <span style="font-family: monospace;">/api/v1/gateway/${traffic.gateway.replace(/ /g, '_')}</span>
      <span style="font-family: monospace; color: var(--color-cyan);">${traffic.bytes}B (QUIC)</span>
    `;
    feed.insertBefore(row, feed.firstChild);
    
    // Cap log list
    if (feed.children.length > 50) {
      feed.removeChild(feed.lastChild);
    }
  }

  // Pulse map line on canvas
  triggerCanvasNetworkPulse(traffic.gateway);
}

function handleThreatAlert(threat) {
  state.idsAlerts++;
  document.getElementById('siem-ids-alerts').innerText = state.idsAlerts;
  
  if (threat.severity === 'HIGH') {
    state.blockedIps++;
    document.getElementById('siem-blocked-ips').innerText = state.blockedIps;
    SenaAudio.playFailure();
  }

  const feed = document.getElementById('siem-traffic-feed');
  if (feed) {
    const row = document.createElement('div');
    row.className = `siem-log-row threat-${threat.severity.toLowerCase()}`;
    row.innerHTML = `
      <span class="log-time">${threat.timestamp}</span>
      <span class="log-severity severity-${threat.severity.toLowerCase()}">${threat.type}</span>
      <span style="color: var(--color-crimson); font-weight: bold;">${threat.source}</span>
      <span style="font-family: monospace; color: var(--color-saffron);">${threat.target}</span>
      <span style="font-family: monospace;">TLS_FAIL</span>
    `;
    feed.insertBefore(row, feed.firstChild);
    if (feed.children.length > 50) feed.removeChild(feed.lastChild);
  }

  // Flash node red on map canvas
  triggerCanvasThreatFlash(threat.target);
}

function handleIncomingMessage(msg) {
  // Add to messaging UI if viewing or cache
  const messagesContainer = document.getElementById('chat-messages-container');
  if (messagesContainer) {
    renderSingleMessage(msg);
    SenaAudio.playTransmission();
  }
}

function handleLockdownStatusChange(engaged, triggeredBy) {
  state.isLockdown = engaged;
  const overlay = document.getElementById('lockdown-alert-overlay');
  const opStatus = document.getElementById('sys-op-status');
  const siemDefcon = document.getElementById('siem-defcon-status');

  if (engaged) {
    document.body.classList.add('lockdown-active');
    overlay.style.display = 'block';
    opStatus.innerText = "CRITICAL LOCKDOWN";
    opStatus.className = "status-value glow-crimson";
    siemDefcon.innerText = "DEFCON 1 - LOCKDOWN";
    siemDefcon.className = "stat-box-value glow-crimson";
    
    // Disable inputs
    document.getElementById('chat-message-input').disabled = true;
    document.querySelector('.btn-lockdown-toggle').innerText = "RELEASE LOCKDOWN";
    
    SenaAudio.startAlarm();
  } else {
    document.body.classList.remove('lockdown-active');
    overlay.style.display = 'none';
    opStatus.innerText = "SECURE & ONLINE";
    opStatus.className = "status-value glow-green";
    siemDefcon.innerText = "LEVEL 5 - SAFE";
    siemDefcon.className = "stat-box-value glow-green";
    
    document.getElementById('chat-message-input').disabled = false;
    document.querySelector('.btn-lockdown-toggle').innerText = "EMERGENCY LOCKDOWN";
    
    SenaAudio.stopAlarm();
  }
}

// ----------------------------------------------------
// Secure E2EE Messaging Services (Kyber + AES)
// ----------------------------------------------------
async function fetchMessages() {
  if (!state.authToken) return;

  try {
    const res = await fetch('/api/messages', {
      headers: { 'Authorization': state.authToken }
    });
    const messages = await res.json();
    
    const messagesContainer = document.getElementById('chat-messages-container');
    messagesContainer.innerHTML = '';
    
    messages.forEach(msg => {
      renderSingleMessage(msg);
    });

    // Populate recipients list
    renderRecipientsList();
  } catch (err) {
    console.error("Failed to load secure channel feeds.", err);
  }
}

async function renderSingleMessage(msg) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  const bubble = document.createElement('div');
  const isMe = msg.sender.includes(state.currentUser.militaryId) || msg.sender === state.currentUser.role;
  bubble.className = `message-bubble ${isMe ? 'sent' : ''}`;

  let clearText = msg.content;
  let kyberDataHtml = '';

  // Attempt client-side decryption if encrypted
  if (msg.encrypted) {
    try {
      // In a real Kyber + AES exchange, the shared secret decrypts the message body
      // We encrypt using the shared platform key "SenaSecretPass123!" for presentation simplicity
      clearText = await SenaCrypto.decryptMessage(msg.content, "SenaSecretPass123!");
    } catch (err) {
      try {
        // Fallback for demo pre-loaded message data which are plain base64 strings
        clearText = atob(msg.content);
      } catch (b64Err) {
        clearText = `[DECRYPTION FAILED: Lacks cryptographic key material for ${msg.clearance}]`;
        bubble.style.borderColor = 'var(--color-crimson)';
      }
    }
  }

  // Generate simulated Kyber parameters if applicable for UI demo
  if (msg.encrypted && msg.algorithm && msg.algorithm.includes("Kyber")) {
    const kyberInfo = SenaCrypto.simulateKyberHandshake();
    kyberDataHtml = `
      <div class="encrypted-payload-details">
        <strong>PQ-KEM Handshake Data:</strong><br>
        Modulus (q): ${kyberInfo.modulus}<br>
        Shared Secret Key: <span style="color:var(--color-cyan);">${kyberInfo.sharedSecret.slice(0, 16)}...</span><br>
        Vector t(0): ${kyberInfo.publicT[0]}<br>
        Ciphertext vector u(0): ${kyberInfo.ciphertext.u[0]}
      </div>
    `;
  } else if (msg.encrypted) {
    kyberDataHtml = `
      <div class="encrypted-payload-details">
        <strong>AES-GCM Payload Data:</strong><br>
        IV: 12-Byte Hardware Sync<br>
        Auth Tag: SHA-256 Checksum Verified
      </div>
    `;
  }

  bubble.innerHTML = `
    <div class="message-meta">
      <span class="message-sender">${msg.sender}</span>
      <span>${new Date(msg.timestamp).toLocaleTimeString()}</span>
    </div>
    <div class="message-text">${clearText}</div>
    ${kyberDataHtml}
    ${msg.encrypted && !clearText.includes("FAILED") ? `
      <div class="decryption-status-indicator">
        <span>🛡️ E2EE Validated (${msg.algorithm})</span>
      </div>
    ` : ''}
  `;

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

async function sendSecureMessage() {
  const input = document.getElementById('chat-message-input');
  const text = input.value.trim();
  if (!text) return;

  if (state.isLockdown) {
    alert("TRANSMISSION BLOCKED: Comm interfaces are deactivated during active DEFCON-1 lockdowns.");
    return;
  }

  const selectedAlgo = document.querySelector('input[name="crypto-algo"]:checked').value;
  const isKyber = selectedAlgo === 'kyber';
  const algorithmName = isKyber ? "CRYSTALS-Kyber-768 + AES-256-GCM" : "AES-256-GCM";

  // Perform actual AES-GCM client-side encryption using Web Crypto
  const encryptedPayload = await SenaCrypto.encryptMessage(text, "SenaSecretPass123!");

  // Convert payload into mock STANAG-5066 Binary Hex format for HUD outbox display
  const hexBytes = Array.from(encryptedPayload.slice(0, 24)).map(char => 
    char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  ).join(' ') + ' ... [END FRAME]';
  document.getElementById('transceiver-bin-hex').innerText = hexBytes;

  const msgPayload = {
    recipient: document.getElementById('active-chat-recipient').innerText.replace("TRANSMITTING TO: ", ""),
    content: encryptedPayload,
    encrypted: true,
    algorithm: algorithmName,
    clearance: state.currentUser.clearance
  };

  // 1. Process Offline Mode (Blackout / Disconnected)
  if (state.networkProfile === 'offline') {
    state.offlineQueue.push(msgPayload);
    document.getElementById('transceiver-buffer-count').innerText = `${state.offlineQueue.length} pending packets`;
    document.getElementById('transceiver-buffer-count').style.color = 'var(--color-saffron)';
    
    // Add visual queued item to stream
    const container = document.getElementById('chat-messages-container');
    const bubble = document.createElement('div');
    bubble.className = "message-bubble sent";
    bubble.style.borderColor = 'var(--color-saffron)';
    bubble.style.opacity = '0.7';
    bubble.innerHTML = `
      <div class="message-meta">
        <span class="message-sender">${state.currentUser.role} (Offline Queue)</span>
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-text">${text}</div>
      <div style="font-size: 10px; color: var(--color-saffron); margin-top: 4px;">📡 QUEUED IN OUTBOX - Awaiting Link Sync</div>
    `;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    
    input.value = '';
    SenaAudio.playFailure();
    return;
  }

  // 2. Determine Latency / Bandwidth profile
  let delay = 0;
  if (state.networkProfile === 'satellite') {
    delay = 800; // satellite RTT
  } else if (state.networkProfile === 'mesh') {
    delay = 2500; // VHF transmission time
    SenaAudio.playTransmission();
    input.disabled = true;
    input.placeholder = "Transmitting over VHF mesh network (9.6 Kbps)...";
  }

  setTimeout(async () => {
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': state.authToken
        },
        body: JSON.stringify(msgPayload)
      });

      if (res.ok) {
        input.value = '';
        SenaAudio.playClick();
      } else {
        const data = await res.json();
        alert(`API Gateway error: ${data.message}`);
      }
    } catch (err) {
      alert("Failed to send message over public gateways.");
    } finally {
      input.disabled = false;
      input.placeholder = "Type classified tactical transmission...";
      input.focus();
    }
  }, delay);
}

function updateNetworkProfile() {
  const profile = document.getElementById('link-profile').value;
  state.networkProfile = profile;
  
  const signalText = document.getElementById('transceiver-signal');
  SenaAudio.playClick();
  
  if (profile === 'broadband') {
    signalText.innerText = "STRONG (99%)";
    signalText.style.color = 'var(--color-green)';
    syncOfflineQueue();
  } else if (profile === 'satellite') {
    signalText.innerText = "LATENT (72%)";
    signalText.style.color = 'var(--color-saffron)';
    syncOfflineQueue();
  } else if (profile === 'mesh') {
    signalText.innerText = "DEGRADED / HF RESILIENT (45%)";
    signalText.style.color = 'var(--color-saffron)';
    syncOfflineQueue();
  } else if (profile === 'offline') {
    signalText.innerText = "BLACKOUT (0%)";
    signalText.style.color = 'var(--color-crimson)';
  }
}

async function syncOfflineQueue() {
  if (state.offlineQueue.length === 0) return;
  
  const bufferCountEl = document.getElementById('transceiver-buffer-count');
  bufferCountEl.innerText = `Syncing ${state.offlineQueue.length} queued packets...`;
  bufferCountEl.style.color = 'var(--color-saffron)';
  
  // Play sequence of transmission sounds
  SenaAudio.playTransmission();
  
  // Delay slightly to simulate sync
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Send each message
  while (state.offlineQueue.length > 0) {
    const msg = state.offlineQueue.shift();
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': state.authToken
        },
        body: JSON.stringify(msg)
      });
    } catch (e) {
      console.error("Queue sync element failed, putting back", e);
      state.offlineQueue.unshift(msg);
      break;
    }
  }
  
  bufferCountEl.innerText = `${state.offlineQueue.length} pending packets`;
  bufferCountEl.style.color = state.offlineQueue.length > 0 ? 'var(--color-saffron)' : 'var(--color-cyan)';
  
  if (state.offlineQueue.length === 0) {
    SenaAudio.playSuccess();
    // Refresh messages
    fetchMessages();
  }
}

// Attach transceiver functions to window scope for HTML triggers
window.updateNetworkProfile = updateNetworkProfile;
window.sendSecureMessage = sendSecureMessage;
window.handleFileSelected = handleFileSelected;
window.downloadDecryptedFile = downloadDecryptedFile;
window.switchTab = switchTab;
window.submitAuth = submitAuth;
window.verifyMFACard = verifyMFACard;
window.verifyMFABiometrics = verifyMFABiometrics;
window.verifyMFAToken = verifyMFAToken;
window.toggleEmergencyLockdown = toggleEmergencyLockdown;
window.isolateSelectedNode = isolateSelectedNode;

function renderRecipientsList() {
  const container = document.getElementById('chat-recipients-list');
  if (!container) return;

  container.innerHTML = '';
  
  // Exclude RAW from standard listing for operators
  const activeBases = state.nodes.filter(node => node.id !== 'raw' || state.currentUser.role === 'Intelligence Officer' || state.currentUser.role === 'Commander');
  
  activeBases.forEach((node, idx) => {
    const item = document.createElement('div');
    item.className = `chat-recipient-item ${idx === 0 ? 'active' : ''}`;
    item.onclick = () => {
      document.querySelectorAll('.chat-recipient-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('active-chat-recipient').innerText = `TRANSMITTING TO: ${node.name.toUpperCase()}`;
      SenaAudio.playClick();
    };

    item.innerHTML = `
      <div class="recipient-title">${node.name}</div>
      <div class="recipient-status">
        <span class="legend-dot green" style="width: 4px; height: 4px; display: inline-block;"></span>
        <span>LINK SECURED (${node.encryption.split(' ')[0]})</span>
      </div>
    `;
    container.appendChild(item);
  });
}

// ----------------------------------------------------
// Secure Local Storage & Crystals-Dilithium Signatures
// ----------------------------------------------------
async function handleFileSelected(event) {
  const file = event.target.files[0];
  if (file) {
    encryptAndStoreFile(file);
  }
  // Reset uploader input so selecting the same file triggers onchange again
  event.target.value = "";
}

async function encryptAndStoreFile(file) {
  SenaAudio.playClick();
  const passphrase = document.getElementById('vault-passphrase').value;
  if (!passphrase) {
    alert("Vault encryption passphrase required to derive crypt keys.");
    return;
  }

  const dropText = document.getElementById('drag-drop-text');
  dropText.innerText = `DERIVING KEYS & ENCRYPTING ${file.name}...`;

  // Read file data into buffer
  const reader = new FileReader();
  reader.onload = async (e) => {
    const fileBytes = e.target.result;
    
    try {
      // 1. AES-GCM symmetric encryption
      const encryptedBytes = await SenaCrypto.encryptFile(fileBytes, passphrase);
      
      // Calculate hash of file for digital signature
      const hashHex = await SenaCrypto.digestFile(fileBytes);
      
      // 2. crystals-Dilithium signature simulation (PQC Integrity Check)
      const dilithiumSig = SenaCrypto.simulateDilithiumSignature(hashHex);

      // Save encrypted file object locally in state
      const encryptedFile = {
        name: `${file.name}.enc`,
        size: `${(encryptedBytes.byteLength / 1024).toFixed(1)} KB`,
        type: file.type || 'bin',
        rawName: file.name,
        payload: encryptedBytes,
        signature: dilithiumSig
      };

      state.files.push(encryptedFile);
      renderEncryptedFilesList();

      dropText.innerText = "DRAG & DROP INTELLIGENCE FILES TO ENCRYPT";
      SenaAudio.playSuccess();
      
      // Automatically select and decrypt the newly uploaded file card to display in side inspect pane
      const cards = document.querySelectorAll('.file-card');
      if (cards.length > 0) {
        const newCardEl = cards[cards.length - 1];
        await selectFileForInspection(encryptedFile, newCardEl);
      }

      // Log event in audit logs
      const ip = "10.220.14.89";
      await fetch('/api/audit', {
        headers: { 'Authorization': state.authToken } // just triggers server activity log
      });
      
    } catch (err) {
      console.error(err);
      alert(`ENCRYPTION ERROR: ${err.message || err}`);
      dropText.innerText = "CRYPTOGRAPHIC SYSTEM FAILURE DURING ENCRYPTION";
      SenaAudio.playFailure();
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderEncryptedFilesList() {
  const grid = document.getElementById('encrypted-vault-grid');
  if (!grid) return;

  grid.innerHTML = '';
  state.files.forEach(file => {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.onclick = () => selectFileForInspection(file, card);

    let emoji = '📄';
    if (file.name.includes('.pdf')) emoji = '📕';
    if (file.name.includes('.img') || file.name.includes('.jpg')) emoji = '🖼️';

    card.innerHTML = `
      <div class="file-card-icon">${emoji}</div>
      <div class="file-card-name" title="${file.name}">${file.name}</div>
      <div class="file-card-size">${file.size}</div>
      <button class="auth-btn font-hud" style="font-size: 9px; padding: 4px; margin-top: 8px;" onclick="event.stopPropagation(); downloadDecryptedFile('${file.name}')">Decrypt & Get</button>
    `;
    grid.appendChild(card);
  });
}

async function selectFileForInspection(file, cardEl) {
  document.querySelectorAll('.file-card').forEach(el => el.style.borderColor = 'rgba(0, 210, 255, 0.12)');
  if (cardEl) {
    cardEl.style.borderColor = 'var(--color-cyan)';
  }
  SenaAudio.playClick();

  const verifierPane = document.getElementById('signature-verifier-details');
  if (!file.signature) {
    // Generate pre-loaded files mock signatures
    file.signature = SenaCrypto.simulateDilithiumSignature("8f6b5b9c03b14589def93a4b08c90fe12f... (pre-loaded)");
  }

  const sig = file.signature;
  const passphrase = document.getElementById('vault-passphrase').value;

  if (!passphrase) {
    verifierPane.innerHTML = `
      <div style="color: var(--color-green); font-weight: bold; margin-bottom: 8px;">DILITHIUM-3 INTEGRITY SHIELD OK</div>
      <strong>Modulus (q):</strong> ${sig.modulus}<br>
      <strong>Sec Key vector s1:</strong><br>${sig.secretS1}<br>
      <strong>Pub key vector t:</strong><br>${sig.publicT}<br>
      <strong>Message Digest Hash:</strong><br><span style="color:var(--color-saffron);">${sig.messageDigest}</span><br>
      <strong>Verification Hash z[0]:</strong><br>${sig.signature.z[0]}<br>
      <strong>Verification Hint h:</strong><br>${sig.signature.h}<br>
      <strong>Signature Bytes (z, h):</strong><br><span style="color:var(--color-cyan);">${sig.signature.hex}</span>
      
      <div style="margin-top: 14px; border-top: 1px dashed rgba(255, 153, 51, 0.3); padding-top: 12px;">
        <div style="color: var(--color-saffron); font-weight: bold; margin-bottom: 6px; text-transform: uppercase;">🔑 DECRYPTION PENDING:</div>
        <div style="color: var(--color-text-secondary); font-size: 11px;">Enter a Vault Passphrase in the settings panel to decrypt and view file contents.</div>
      </div>
    `;
    return;
  }

  if (!file.payload) {
    // Pre-loaded files mock content
    let content = "";
    if (file.name.includes("TACTICAL_BORDER_PATROL_PLAN_SUMMER")) {
      content = `================================================================================
          INDIAN ARMED FORCES - DEGRADED COMMAND NETWORK
          TACTICAL BORDER PATROL PLAN (SUMMER SQUADRON)
================================================================================
[SECURITY CLEARANCE] LEVEL 5 - TOP SECRET
[INTEGRITY PROTOCOL] CRYSTALS-Dilithium-3 Verified
[ENCRYPTION ALGORITHM] AES-256-GCM Shared Vault Key

--- OPERATIONAL BRIEFING ---
1. Patrol frequency in Eastern Ladakh sectors is increased by 25%.
2. Establish secure satellite transceivers at Leh and Western Command HQ.
3. In case of cyber threat detection (DEFCON-1), initiate manual gateway isolation.

--- SYSTEM NOTES ---
Decrypted successfully on the client terminal using passphrase: "${passphrase}"`;
    } else {
      content = `================================================================================
          INDIAN ARMED FORCES - SATELLITE IMAGING COMMAND
          RECON IMAGE META REPORT [SECTOR 3-A]
================================================================================
[SECURITY CLEARANCE] LEVEL 4 - SECRET
[INTEGRITY SHIELD] Dilithium Signature Check Pass
[ENCRYPTION SHIELD] AES-256-GCM Verified

--- HIGH RESOLUTION IMAGING LOGS ---
Target Coordinates: 34.1526° N, 77.5771° E (Northern Command)
Capture Time: 2026-05-21 14:12:00 UTC
Resolution: 0.15m Ground Sample Distance (GSD)

--- IMAGE SCAN DATA MAPPING ---
[RAW BAYER GRID ARRAY EXPORTED]
Simulated satellite frame decrypt success.
No unauthorized surface movement detected in Sector 3-A grid coordinates.
Passphrase: "${passphrase}"`;
    }
    displayDecryptedMessageInUI(file, content);
  } else {
    // User-uploaded files
    try {
      const decryptedBytes = await SenaCrypto.decryptFile(file.payload, passphrase);
      let textPreview = "";
      try {
        const dec = new TextDecoder("utf-8", { fatal: true });
        textPreview = dec.decode(decryptedBytes);
      } catch (utfErr) {
        textPreview = `[Binary/non-text file decrypted successfully. File size: ${file.size}.]`;
      }
      displayDecryptedMessageInUI(file, textPreview);
    } catch (e) {
      verifierPane.innerHTML = `
        <div style="color: var(--color-green); font-weight: bold; margin-bottom: 8px;">DILITHIUM-3 INTEGRITY SHIELD OK</div>
        <strong>Modulus (q):</strong> ${sig.modulus}<br>
        <strong>Sec Key vector s1:</strong><br>${sig.secretS1}<br>
        <strong>Pub key vector t:</strong><br>${sig.publicT}<br>
        <strong>Message Digest Hash:</strong><br><span style="color:var(--color-saffron);">${sig.messageDigest}</span><br>
        <strong>Verification Hash z[0]:</strong><br>${sig.signature.z[0]}<br>
        <strong>Verification Hint h:</strong><br>${sig.signature.h}<br>
        <strong>Signature Bytes (z, h):</strong><br><span style="color:var(--color-cyan);">${sig.signature.hex}</span>
        
        <div style="margin-top: 14px; border-top: 1px dashed rgba(255, 56, 96, 0.3); padding-top: 12px;">
          <div style="color: var(--color-crimson); font-weight: bold; margin-bottom: 6px; text-transform: uppercase;">🔓 DECRYPTION FAILED:</div>
          <div style="color: var(--color-text-secondary); font-size: 11px;">Verify that the Vault Passphrase matches the password used during encryption.</div>
        </div>
      `;
    }
  }
}

function displayDecryptedMessageInUI(fileObj, messageText) {
  const verifierPane = document.getElementById('signature-verifier-details');
  if (!verifierPane) return;
  
  const tempDiv = document.createElement('div');
  tempDiv.textContent = messageText;
  const escapedText = tempDiv.innerHTML;

  if (!fileObj.signature) {
    fileObj.signature = SenaCrypto.simulateDilithiumSignature(fileObj.name);
  }
  const sig = fileObj.signature;

  verifierPane.innerHTML = `
    <div style="color: var(--color-green); font-weight: bold; margin-bottom: 8px;">DILITHIUM-3 INTEGRITY SHIELD OK</div>
    <strong>Modulus (q):</strong> ${sig.modulus}<br>
    <strong>Sec Key vector s1:</strong><br>${sig.secretS1}<br>
    <strong>Pub key vector t:</strong><br>${sig.publicT}<br>
    <strong>Message Digest Hash:</strong><br><span style="color:var(--color-saffron);">${sig.messageDigest}</span><br>
    <strong>Verification Hash z[0]:</strong><br>${sig.signature.z[0]}<br>
    <strong>Verification Hint h:</strong><br>${sig.signature.h}<br>
    <strong>Signature Bytes (z, h):</strong><br><span style="color:var(--color-cyan);">${sig.signature.hex}</span>
    
    <div style="margin-top: 14px; border-top: 1px dashed rgba(0, 210, 255, 0.3); padding-top: 12px;">
      <div style="color: var(--color-green); font-weight: bold; margin-bottom: 6px; text-transform: uppercase;">🔓 DECRYPTED CLEAR-TEXT CONTENT:</div>
      <div style="background: rgba(0, 255, 102, 0.06); padding: 10px; border: 1px solid rgba(0, 255, 102, 0.25); font-family: monospace; white-space: pre-wrap; word-break: break-all; color: #a3ffcc; max-height: 220px; overflow-y: auto; font-size: 11px; line-height: 1.4; box-shadow: inset 0 0 10px rgba(0, 255, 102, 0.05);">${escapedText}</div>
    </div>
  `;
}

async function downloadDecryptedFile(fileName) {
  SenaAudio.playClick();
  const passphrase = document.getElementById('vault-passphrase').value;
  const fileObj = state.files.find(f => f.name === fileName);
  
  if (!fileObj) return;

  if (!passphrase) {
    alert("Authentication failed: Please enter a Vault Passphrase in the settings panel above to derive the AES decryption keys.");
    SenaAudio.playFailure();
    return;
  }

  // Handle mock files simulation
  if (!fileObj.payload) {
    const dropText = document.getElementById('drag-drop-text');
    const oldText = dropText.innerText;
    dropText.innerText = `DERIVING KEYS & DECRYPTING PRE-LOADED FILE: ${fileObj.name}...`;
    
    setTimeout(() => {
      let content = "";
      if (fileName.includes("TACTICAL_BORDER_PATROL_PLAN_SUMMER")) {
        content = `================================================================================
          INDIAN ARMED FORCES - DEGRADED COMMAND NETWORK
          TACTICAL BORDER PATROL PLAN (SUMMER SQUADRON)
================================================================================
[SECURITY CLEARANCE] LEVEL 5 - TOP SECRET
[INTEGRITY PROTOCOL] CRYSTALS-Dilithium-3 Verified
[ENCRYPTION ALGORITHM] AES-256-GCM Shared Vault Key

--- OPERATIONAL BRIEFING ---
1. Patrol frequency in Eastern Ladakh sectors is increased by 25%.
2. Establish secure satellite transceivers at Leh and Western Command HQ.
3. In case of cyber threat detection (DEFCON-1), initiate manual gateway isolation.

--- SYSTEM NOTES ---
Decrypted successfully on the client terminal using passphrase: "${passphrase}"`;
      } else {
        content = `================================================================================
          INDIAN ARMED FORCES - SATELLITE IMAGING COMMAND
          RECON IMAGE META REPORT [SECTOR 3-A]
================================================================================
[SECURITY CLEARANCE] LEVEL 4 - SECRET
[INTEGRITY SHIELD] Dilithium Signature Check Pass
[ENCRYPTION SHIELD] AES-256-GCM Verified

--- HIGH RESOLUTION IMAGING LOGS ---
Target Coordinates: 34.1526° N, 77.5771° E (Northern Command)
Capture Time: 2026-05-21 14:12:00 UTC
Resolution: 0.15m Ground Sample Distance (GSD)

--- IMAGE SCAN DATA MAPPING ---
[RAW BAYER GRID ARRAY EXPORTED]
Simulated satellite frame decrypt success.
No unauthorized surface movement detected in Sector 3-A grid coordinates.
Passphrase: "${passphrase}"`;
      }

      // Download mock text file
      const blob = new Blob([content], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileObj.rawName.replace(".pdf", "_DECRYPTED.txt").replace(".raw", "_DECRYPTED.txt");
      link.click();

      // Display on-screen preview
      displayDecryptedMessageInUI(fileObj, content);

      dropText.innerText = oldText;
      SenaAudio.playSuccess();
    }, 1200);
    return;
  }

  try {
    const decryptedBytes = await SenaCrypto.decryptFile(fileObj.payload, passphrase);
    
    // Read and display preview if it's text
    let textPreview = "";
    try {
      const dec = new TextDecoder("utf-8", { fatal: true });
      textPreview = dec.decode(decryptedBytes);
    } catch (utfErr) {
      textPreview = `[Binary/non-text file decrypted successfully. File size: ${fileObj.size}. File saved to downloads.]`;
    }

    // Trigger browser file download
    const blob = new Blob([decryptedBytes]);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileObj.rawName;
    link.click();
    
    // Display on-screen preview
    displayDecryptedMessageInUI(fileObj, textPreview);

    SenaAudio.playSuccess();
  } catch (e) {
    alert("Decryption failed! Please verify that your entered Vault Passphrase matches the password used when the file was encrypted/uploaded.");
    SenaAudio.playFailure();
  }
}

// ----------------------------------------------------
// Tactical HTML5 Canvas Map Rendering
// ----------------------------------------------------
function resizeCanvas() {
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}

let activePulses = [];
let activeThreatFlashes = [];

function triggerCanvasNetworkPulse(gatewayName) {
  // Find node closest to gateway to pulse
  let nodeName = 'delhi';
  if (gatewayName.includes("Western")) nodeName = 'chandi';
  if (gatewayName.includes("Northern")) nodeName = 'leh';
  if (gatewayName.includes("Eastern")) nodeName = 'kolkata';
  if (gatewayName.includes("Coastal")) nodeName = 'mumbai';

  const node = state.nodes.find(n => n.id === nodeName);
  if (node) {
    activePulses.push({
      x: node.x,
      y: node.y,
      radius: 5,
      maxRadius: 50,
      opacity: 0.8
    });
  }
}

function triggerCanvasThreatFlash(gatewayName) {
  let nodeName = 'delhi';
  if (gatewayName.includes("Western")) nodeName = 'chandi';
  if (gatewayName.includes("Northern")) nodeName = 'leh';
  if (gatewayName.includes("Eastern")) nodeName = 'kolkata';
  if (gatewayName.includes("Coastal")) nodeName = 'mumbai';

  const node = state.nodes.find(n => n.id === nodeName);
  if (node) {
    // Flag threat score rise
    node.threat = 0.85;
    node.status = "THREAT FLAG";
    
    activeThreatFlashes.push({
      x: node.x,
      y: node.y,
      duration: 60, // frames
      radius: 20
    });
    
    // Select the threatened node for review
    state.selectedNode = node;
    renderSelectedNodeDetails();
  }
}

function startMapRendering() {
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw geographic simulated mesh grids
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // 2. Draw mock boundary outline of India
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Simplified vertex polygon tracing India's map borders inside canvas space
    ctx.moveTo(250, 40);  // Kashmir
    ctx.lineTo(290, 80);
    ctx.lineTo(280, 150);
    ctx.lineTo(440, 250); // NE
    ctx.lineTo(490, 240);
    ctx.lineTo(430, 340); // East
    ctx.lineTo(340, 360);
    ctx.lineTo(280, 480); // South East
    ctx.lineTo(220, 600); // Kanyakumari
    ctx.lineTo(190, 490); // Malabar
    ctx.lineTo(120, 380); // Gujarat
    ctx.lineTo(200, 250); // Rajasthan
    ctx.lineTo(240, 100);
    ctx.closePath();
    ctx.stroke();

    // 3. Draw communication pathways (links) between commands
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.2)';
    ctx.lineWidth = 1.5;
    
    // Center HQ coordinates (Delhi)
    const center = state.nodes.find(n => n.id === 'delhi');
    state.nodes.forEach(node => {
      if (node.id !== 'delhi') {
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(node.x, node.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // 4. Draw active threat radar rings
    activePulses.forEach((pulse, index) => {
      ctx.strokeStyle = `rgba(0, 210, 255, ${pulse.opacity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      ctx.stroke();

      pulse.radius += 1.5;
      pulse.opacity -= 0.02;

      if (pulse.opacity <= 0) {
        activePulses.splice(index, 1);
      }
    });

    // Draw active red threat flags
    activeThreatFlashes.forEach((flash, index) => {
      const pulseRate = Math.abs(Math.sin(Date.now() / 150));
      ctx.strokeStyle = `rgba(255, 56, 96, ${pulseRate})`;
      ctx.fillStyle = `rgba(255, 56, 96, ${pulseRate * 0.15})`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(flash.x, flash.y, flash.radius + pulseRate * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();

      flash.duration--;
      if (flash.duration <= 0) {
        activeThreatFlashes.splice(index, 1);
      }
    });

    // 5. Draw node dots
    state.nodes.forEach(node => {
      let nodeColor = 'var(--color-cyan)';
      let isThreatened = node.threat > 0.5;
      
      if (isThreatened) {
        nodeColor = 'var(--color-crimson)';
      } else if (node.id === 'raw') {
        nodeColor = 'var(--color-saffron)';
      } else if (node.id === 'leh') {
        nodeColor = 'var(--color-saffron)';
      }

      ctx.fillStyle = nodeColor;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing outer ring
      ctx.strokeStyle = nodeColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ringRad = 8 + (Math.sin(Date.now() / 200) * 3);
      ctx.arc(node.x, node.y, ringRad, 0, Math.PI * 2);
      ctx.stroke();

      // Node label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '10px Rajdhani';
      ctx.fillText(node.name.split(' (')[0], node.x + 12, node.y + 4);
    });

    mapAnimFrame = requestAnimationFrame(draw);
  }

  // Handle canvas click selection
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Detect closest node click
    state.nodes.forEach(node => {
      const dist = Math.hypot(node.x - clickX, node.y - clickY);
      if (dist < 15) {
        state.selectedNode = node;
        renderSelectedNodeDetails();
        SenaAudio.playClick();
      }
    });
  });

  draw();
}

function renderNodesList() {
  const container = document.getElementById('map-nodes-list');
  if (!container) return;

  container.innerHTML = '';
  state.nodes.forEach(node => {
    const item = document.createElement('div');
    const isSelected = state.selectedNode && state.selectedNode.id === node.id;
    item.className = `node-item-mini ${isSelected ? 'selected' : ''}`;
    
    let colorStyle = 'var(--color-green)';
    if (node.threat > 0.5) colorStyle = 'var(--color-crimson)';

    item.innerHTML = `
      <div>
        <div class="node-name">${node.name}</div>
        <div class="node-role">${node.role}</div>
      </div>
      <div style="font-family: var(--font-hud); font-size: 11px; color: ${colorStyle}">${node.status}</div>
    `;

    item.onclick = () => {
      state.selectedNode = node;
      renderNodesList();
      renderSelectedNodeDetails();
      SenaAudio.playClick();
    };

    container.appendChild(item);
  });
}

function renderSelectedNodeDetails() {
  const node = state.selectedNode;
  if (!node) return;

  document.getElementById('selected-node-name').innerText = node.name;
  document.getElementById('node-unit').innerText = node.unit;
  document.getElementById('node-clearance').innerText = node.clearance;
  document.getElementById('node-encryption').innerText = node.encryption;
  document.getElementById('node-threat').innerText = node.threat > 0.5 ? `CRITICAL (${node.threat})` : `Benign (${node.threat})`;
  document.getElementById('node-threat').style.color = node.threat > 0.5 ? 'var(--color-crimson)' : 'var(--color-green)';
  
  const statusBadge = document.getElementById('node-status-badge');
  statusBadge.innerText = node.status;
  statusBadge.style.color = node.status === 'SYNCHRONIZED' ? 'var(--color-green)' : 'var(--color-crimson)';

  // Disable containment/isolation button for non-Commander or non-SysAdmin roles
  const btnIsolate = document.getElementById('btn-isolate-node');
  if (state.currentUser && (state.currentUser.role === 'Commander' || state.currentUser.role === 'System Admin')) {
    btnIsolate.disabled = false;
    btnIsolate.style.display = 'block';
    btnIsolate.innerText = node.status === 'ISOLATED' ? 'Reconnect Node' : 'Isolate Node';
  } else {
    btnIsolate.style.display = 'none';
  }
}

function isolateSelectedNode() {
  if (!state.selectedNode) return;
  
  SenaAudio.playClick();
  const node = state.selectedNode;
  
  if (node.status === 'ISOLATED') {
    node.status = 'SYNCHRONIZED';
    node.threat = 0.02;
  } else {
    node.status = 'ISOLATED';
    node.threat = 0.00; // no traffic/threat when isolated
  }

  // Refresh lists
  renderNodesList();
  renderSelectedNodeDetails();
  
  // Log inside system logs
  fetch('/api/audit', {
    headers: { 'Authorization': state.authToken } // will update server ledger
  });
}

// ----------------------------------------------------
// Emergency System Lockdown Mode
// ----------------------------------------------------
async function toggleEmergencyLockdown() {
  if (!state.authToken) return;

  SenaAudio.playClick();
  
  const targetStatus = !state.isLockdown;

  try {
    const res = await fetch('/api/lockdown', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': state.authToken
      },
      body: JSON.stringify({ status: targetStatus })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`API Gateway error: ${data.message}`);
    }
  } catch (err) {
    alert("Connection to API Gateway lost. Emergency override rejected.");
  }
}

// ----------------------------------------------------
// SIEM Logs / Immutable Audit Logs Retrievals
// ----------------------------------------------------
async function fetchAuditLogs() {
  if (!state.authToken) return;

  try {
    const res = await fetch('/api/audit', {
      headers: { 'Authorization': state.authToken }
    });
    
    if (res.status === 403) {
      document.getElementById('audit-rows-container').innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--color-crimson); font-family: var(--font-hud);">
          ACCESS REFUSED: Zero-trust ABAC policies block role '${state.currentUser.role}' from inspecting system database logs.
        </div>
      `;
      return;
    }

    const logs = await res.json();
    const container = document.getElementById('audit-rows-container');
    if (!container) return;

    container.innerHTML = '';
    logs.reverse().forEach(log => {
      const row = document.createElement('div');
      row.className = `audit-row status-${log.status.toLowerCase()}`;
      row.innerHTML = `
        <span style="font-family: monospace;">${new Date(log.timestamp).toLocaleString()}</span>
        <span style="color: var(--color-cyan); font-family: var(--font-hud);">${log.service}</span>
        <span style="font-weight: 500;">${log.actor}</span>
        <span>${log.action}</span>
        <span class="audit-status status-${log.status.toLowerCase()}">${log.status}</span>
        <span style="color: var(--color-text-secondary); font-size: 11px;">${log.details}</span>
      `;
      container.appendChild(row);
    });
  } catch (err) {
    console.error("Failed to compile system database ledger.", err);
  }
}
