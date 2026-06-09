const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple mock databases
const messages = [
  {
    id: 1,
    sender: "Northern Command HQ",
    recipient: "Western Command HQ",
    timestamp: new Date(Date.now() - 600000).toISOString(),
    content: "U2VuYS1TZWN1cmUgQWN0aXZhdGVkLiBOZXcga2V5cyBleGNoYW5nZWQu", // Base64 encoded mock encrypted payload
    encrypted: true,
    algorithm: "CRYSTALS-Kyber + AES-256-GCM",
    clearance: "L4 - Secret"
  },
  {
    id: 2,
    sender: "Naval Operations Command",
    recipient: "Eastern Command HQ",
    timestamp: new Date(Date.now() - 300000).toISOString(),
    content: "UGF0cm9sIHZlc3NlbHMgcG9zaXRpb25lZCBhdCBzZWN0b3IgMy1BLiBTdGF0dXMgT0su",
    encrypted: true,
    algorithm: "AES-256-GCM",
    clearance: "L3 - Confidential"
  }
];

const auditLogs = [
  {
    id: 1,
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    service: "AuthService",
    actor: "SENA-CDR-01 (Commander)",
    action: "Zero-Trust Login Success",
    ip: "10.220.14.89",
    status: "SUCCESS",
    details: "MFA Validated: Smart Card ID Verified, Iris Match 99.4%, Hardware Token Sync OK."
  },
  {
    id: 2,
    timestamp: new Date(Date.now() - 3200000).toISOString(),
    service: "Gateway",
    actor: "SENA-CDR-01 (Commander)",
    action: "Establish IPSec Tunnel",
    ip: "10.220.14.89",
    status: "SUCCESS",
    details: "Route set through Western Gateway. Cryptographic handshake complete."
  },
  {
    id: 3,
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    service: "ThreatMonitor",
    actor: "SYSTEM",
    action: "Intrusion Detection Sweep",
    ip: "127.0.0.1",
    status: "INFO",
    details: "Suricata scans clear. No signature anomalies detected on backbone gateways."
  }
];

// Valid credentials matching military roles
const users = {
  "SENA-CDR-01": { pin: "1122", name: "Gen. R. K. Singh", role: "Commander", rank: "General", clearance: "L5 - Operational Command", division: "Army HQ (New Delhi)" },
  "SENA-INT-05": { pin: "3344", name: "Col. Neha Sharma", role: "Intelligence Officer", rank: "Colonel", clearance: "L4 - Secret Clearance", division: "RAW Liaison Office" },
  "SENA-FLD-12": { pin: "5566", name: "Maj. Vikramaditya", role: "Field Operator", rank: "Major", clearance: "L3 - Confidential Clearance", division: "Northern Command (Leh)" },
  "SENA-AUD-02": { pin: "7788", name: "Dr. A. P. Subramanian", role: "Auditor", rank: "Chief Inspector", clearance: "L4 - Audit Clearance", division: "MoD Comptroller" },
  "SENA-ADM-99": { pin: "9900", name: "Wng Cmdr S. Patel", role: "System Admin", rank: "Wing Commander", clearance: "L5 - System Clearance", division: "Joint Cyber Command" }
};

// Log helper to simulate SIEM log storage
function logAction(service, actor, action, ip, status, details) {
  const newLog = {
    id: auditLogs.length + 1,
    timestamp: new Date().toISOString(),
    service,
    actor,
    action,
    ip,
    status,
    details
  };
  auditLogs.push(newLog);
  return newLog;
}

// ----------------------------------------------------
// REST APIs (Simulating API Gateway & Microservices)
// ----------------------------------------------------

// Zero-Trust Auth Microservice
app.post('/api/auth/login', (req, res) => {
  const { militaryId, pin, cardToken, irisScanned, hardwareSync } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  const user = users[militaryId];
  if (!user || user.pin !== pin) {
    logAction("AuthService", militaryId || "UNKNOWN", "MFA Login Failed", ip, "FAILURE", "Invalid Military ID or security PIN.");
    return res.status(401).json({ success: false, message: "Invalid credentials. Incident logged to Threat Monitoring." });
  }

  // Validate MFA factors (smart card, biometric, hardware token)
  if (!cardToken || !irisScanned || !hardwareSync) {
    logAction("AuthService", militaryId, "MFA Verification Bypassed", ip, "FAILURE", "MFA validation failed. Missing hardware or biometric flags.");
    return res.status(400).json({ success: false, message: "Multi-Factor Authentication components incomplete." });
  }

  // Session Token creation (Simulated JWT / JWE)
  const token = Buffer.from(JSON.stringify({
    militaryId,
    role: user.role,
    clearance: user.clearance,
    exp: Date.now() + 1800000 // 30 mins session
  })).toString('base64');

  logAction("AuthService", militaryId, "Zero-Trust Login Approved", ip, "SUCCESS", `User ${user.name} logged in from authenticated device. Role: ${user.role}.`);

  return res.json({
    success: true,
    token,
    user: {
      name: user.name,
      role: user.role,
      rank: user.rank,
      clearance: user.clearance,
      division: user.division
    }
  });
});

// Secure Messaging Microservice
app.get('/api/messages', (req, res) => {
  // Simple auth gateway simulation
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ success: false, message: "Access Denied. Token required." });
  
  res.json(messages);
});

app.post('/api/messages', (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ success: false, message: "Access Denied. Token required." });

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('ascii'));
    // Access control: only Commanders, Intel Officers, and Field Operators can send messages
    if (!["Commander", "Intelligence Officer", "Field Operator"].includes(payload.role)) {
      logAction("MessagingService", payload.militaryId, "Send Message Denied", req.ip, "FAILURE", "Access Denied: Role lacks Messaging permissions.");
      return res.status(403).json({ success: false, message: "Unauthorized role for sending secure transmissions." });
    }

    const { recipient, content, encrypted, algorithm, clearance } = req.body;
    const newMessage = {
      id: messages.length + 1,
      sender: `${payload.role} (${payload.militaryId})`,
      recipient,
      timestamp: new Date().toISOString(),
      content,
      encrypted: !!encrypted,
      algorithm: algorithm || "AES-256-GCM",
      clearance: clearance || "L3 - Confidential"
    };

    messages.push(newMessage);
    logAction("MessagingService", payload.militaryId, "Secure Message Transmission", req.ip, "SUCCESS", `Encrypted packet sent to ${recipient} using ${algorithm}.`);

    // Broadcast message update to WebSockets
    broadcastToWS({ type: "NEW_MESSAGE", message: newMessage });

    res.status(201).json(newMessage);
  } catch (err) {
    res.status(400).json({ success: false, message: "Invalid session token format." });
  }
});

// Audit Logging Microservice (Auditor-only access)
app.get('/api/audit', (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ success: false, message: "Access Denied. Token required." });

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('ascii'));
    if (!["Auditor", "System Admin", "Commander"].includes(payload.role)) {
      logAction("AuditService", payload.militaryId, "Audit Log Access Denied", req.ip, "FAILURE", "Unauthorized access attempt to immutable audit trail.");
      return res.status(403).json({ success: false, message: "Access Denied: Lacks audit inspection clearance." });
    }

    logAction("AuditService", payload.militaryId, "Audit Logs Retrieved", req.ip, "SUCCESS", "Auditor accessed database audit logs.");
    res.json(auditLogs);
  } catch (err) {
    res.status(400).json({ success: false, message: "Invalid session token." });
  }
});

// Emergency Lockdown Trigger (Commander-only)
app.post('/api/lockdown', (req, res) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ success: false, message: "Access Denied. Token required." });

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('ascii'));
    if (payload.role !== "Commander" && payload.role !== "System Admin") {
      logAction("Gateway", payload.militaryId, "Unauthorized Lockdown Attempt", req.ip, "CRITICAL", "User attempted to trigger emergency platform lockdown without credentials.");
      return res.status(403).json({ success: false, message: "Authorization failed: Commander clearance required." });
    }

    const { status } = req.body;
    logAction("Gateway", payload.militaryId, `Emergency Lockdown State: ${status ? 'ENGAGED' : 'DISENGAGED'}`, req.ip, "CRITICAL", `Platform lockdown triggered. All external routing paths ${status ? 'severed' : 'restored'}.`);

    // Broadcast lockdown state to all connected terminals
    broadcastToWS({ type: "LOCKDOWN_STATUS", engaged: status, triggeredBy: payload.militaryId });

    res.json({ success: true, message: `Emergency lockdown state updated to ${status}` });
  } catch (err) {
    res.status(400).json({ success: false, message: "Invalid session token." });
  }
});

// Create Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket client registry
let wsClients = [];

wss.on('connection', (ws, req) => {
  wsClients.push(ws);
  
  // Send immediate greeting and current system stats
  ws.send(JSON.stringify({
    type: "SYSTEM_CONNECT",
    threatLevel: "READY",
    activeConnections: wsClients.length
  }));

  ws.on('close', () => {
    wsClients = wsClients.filter(client => client !== ws);
  });
});

// Helper to broadcast WS messages
function broadcastToWS(data) {
  const payload = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ----------------------------------------------------
// Real-time Threat & Traffic Simulation
// ----------------------------------------------------
const gateways = ["Western Border Gateway", "Northern Region Gateway", "Eastern Border Gateway", "Coastal Command Gateway"];
const threatTypes = ["DDOS", "PORT_SCAN", "MITM_ATTEMPT", "BRUTE_FORCE", "ANOMALOUS_OUTFLOW"];
const IPs = ["185.220.101.4", "94.23.25.109", "109.201.154.218", "195.154.122.25", "10.220.109.112"];

setInterval(() => {
  if (wsClients.length === 0) return;

  // Generate continuous random benign traffic logs
  const bytes = Math.floor(Math.random() * 5000) + 120;
  const gw = gateways[Math.floor(Math.random() * gateways.length)];
  const status = Math.random() > 0.95 ? 403 : 200;
  
  broadcastToWS({
    type: "TRAFFIC_PULSE",
    traffic: {
      gateway: gw,
      bytes,
      status,
      timestamp: new Date().toLocaleTimeString()
    }
  });

  // Periodically generate a simulated threat event (approx every 15 seconds)
  if (Math.random() > 0.85) {
    const isAttacking = Math.random() > 0.3;
    if (isAttacking) {
      const threatType = threatTypes[Math.floor(Math.random() * threatTypes.length)];
      const sourceIp = IPs[Math.floor(Math.random() * IPs.length)];
      const gateway = gateways[Math.floor(Math.random() * gateways.length)];
      const severity = threatType === "DDOS" || threatType === "ANOMALOUS_OUTFLOW" ? "HIGH" : "MEDIUM";
      
      const threatDetail = {
        timestamp: new Date().toLocaleTimeString(),
        type: threatType,
        source: sourceIp,
        target: gateway,
        severity,
        details: `Intrusion Alert: ${threatType} detected by Suricata IDS. Firewall rules active.`
      };

      // Auto logging to audit trail if severe
      if (severity === "HIGH") {
        logAction("ThreatMonitor", "IDS/IPS", `Threat Containment Activated: ${threatType}`, sourceIp, "WARNING", `System auto-blocked source IP. Network path to ${gateway} throttled.`);
      }

      broadcastToWS({
        type: "THREAT_ALERT",
        threat: threatDetail
      });
    }
  }
}, 3000);

server.listen(port, () => {
  console.log(`[Sena-Secure] Platform server online at http://localhost:${port}`);
});
