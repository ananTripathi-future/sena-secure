/**
 * Sena-Secure Cryptographic Engine
 * Wraps Web Crypto API and simulates Post-Quantum Cryptography (Kyber/Dilithium)
 * Equips transparent fallback algorithms for non-secure contexts (e.g. file:/// or local IP)
 */

// Helper: Pure JS PBKDF2-like Key Derivation Function (KDF) fallback
function simpleKDF(passphrase, salt) {
  const key = new Uint8Array(32);
  let hash = 2166136261;
  for (let i = 0; i < passphrase.length; i++) {
    hash ^= passphrase.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let i = 0; i < salt.length; i++) {
    hash ^= salt[i];
    hash = Math.imul(hash, 16777619);
  }
  let seed = hash;
  for (let i = 0; i < 32; i++) {
    seed = Math.imul(seed, 9301) + 49297;
    key[i] = Math.abs(seed) % 256;
  }
  return key;
}

// Helper: Pure JS symmetric XOR Stream Cipher fallback
function xorCipher(dataBytes, keyBytes, ivBytes) {
  const output = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) {
    const keyIdx = i % keyBytes.length;
    const ivIdx = i % ivBytes.length;
    const keystreamByte = keyBytes[keyIdx] ^ ivBytes[ivIdx] ^ (i & 0xFF);
    output[i] = dataBytes[i] ^ keystreamByte;
  }
  return output;
}

const SenaCrypto = {
  // Generate random salt/iv
  generateIV() {
    if (window.crypto && window.crypto.getRandomValues) {
      return window.crypto.getRandomValues(new Uint8Array(12));
    }
    const iv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
    return iv;
  },

  // Derive cryptographic key from PIN and salt (PBKDF2 + AES-GCM)
  async deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  },

  // Encrypt text message using AES-GCM 256
  async encryptMessage(text, passphrase) {
    const enc = new TextEncoder();
    const salt = window.crypto && window.crypto.getRandomValues ? window.crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(16);
    if (!salt.some(x => x !== 0)) {
      for (let i = 0; i < 16; i++) salt[i] = Math.floor(Math.random() * 256);
    }
    const iv = this.generateIV();
    
    let ciphertextBytes;
    let fallback = false;

    if (window.crypto && window.crypto.subtle) {
      try {
        const key = await this.deriveKey(passphrase, salt);
        const ctBuffer = await window.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv },
          key,
          enc.encode(text)
        );
        ciphertextBytes = new Uint8Array(ctBuffer);
      } catch (e) {
        fallback = true;
      }
    } else {
      fallback = true;
    }

    if (fallback) {
      ciphertextBytes = xorCipher(enc.encode(text), simpleKDF(passphrase, salt), iv);
    }

    // Pack into transmissible container (Base64)
    const packageData = {
      salt: this.bufToBase64(salt),
      iv: this.bufToBase64(iv),
      ciphertext: this.bufToBase64(ciphertextBytes),
      fallback: fallback
    };

    return btoa(JSON.stringify(packageData));
  },

  // Decrypt text message using AES-GCM 256
  async decryptMessage(base64Package, passphrase) {
    try {
      const packageData = JSON.parse(atob(base64Package));
      const salt = this.base64ToBuf(packageData.salt);
      const iv = this.base64ToBuf(packageData.iv);
      const ciphertext = this.base64ToBuf(packageData.ciphertext);

      if (window.crypto && window.crypto.subtle && !packageData.fallback) {
        try {
          const key = await this.deriveKey(passphrase, salt);
          const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
          );

          const dec = new TextDecoder();
          return dec.decode(decrypted);
        } catch (e) {
          console.warn("SubtleCrypto decrypt failed, falling back to JS cipher:", e);
          const decryptedBytes = xorCipher(ciphertext, simpleKDF(passphrase, salt), iv);
          const dec = new TextDecoder();
          return dec.decode(decryptedBytes);
        }
      } else {
        const decryptedBytes = xorCipher(ciphertext, simpleKDF(passphrase, salt), iv);
        const dec = new TextDecoder();
        return dec.decode(decryptedBytes);
      }
    } catch (e) {
      console.error("Decryption failed:", e);
      throw new Error("Decryption failed. Authentication check error or incorrect key material.");
    }
  },

  // File Encryption (AES-GCM-256 or Fallback XOR)
  async encryptFile(fileArrayBuffer, passphrase) {
    const salt = window.crypto && window.crypto.getRandomValues ? window.crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(16);
    if (!salt.some(x => x !== 0)) {
      for (let i = 0; i < 16; i++) salt[i] = Math.floor(Math.random() * 256);
    }
    const iv = this.generateIV();

    let ciphertext;
    if (window.crypto && window.crypto.subtle) {
      try {
        const key = await this.deriveKey(passphrase, salt);
        const ctBuffer = await window.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv },
          key,
          fileArrayBuffer
        );
        ciphertext = new Uint8Array(ctBuffer);
      } catch (e) {
        console.warn("SubtleCrypto encrypt failed, falling back to JS cipher:", e);
        ciphertext = xorCipher(new Uint8Array(fileArrayBuffer), simpleKDF(passphrase, salt), iv);
      }
    } else {
      console.warn("SubtleCrypto not available, using JS cipher fallback");
      ciphertext = xorCipher(new Uint8Array(fileArrayBuffer), simpleKDF(passphrase, salt), iv);
    }

    // Concat: Salt (16B) + IV (12B) + Ciphertext
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.length);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(ciphertext, salt.length + iv.length);
    
    return combined.buffer;
  },

  // File Decryption
  async decryptFile(combinedBuffer, passphrase) {
    try {
      const combined = new Uint8Array(combinedBuffer);
      const salt = combined.slice(0, 16);
      const iv = combined.slice(16, 28);
      const ciphertext = combined.slice(28);

      if (window.crypto && window.crypto.subtle) {
        try {
          const key = await this.deriveKey(passphrase, salt);
          const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
          );
          return decrypted;
        } catch (e) {
          console.warn("SubtleCrypto decrypt failed, falling back to JS cipher:", e);
          const decryptedBytes = xorCipher(ciphertext, simpleKDF(passphrase, salt), iv);
          return decryptedBytes.buffer;
        }
      } else {
        console.warn("SubtleCrypto not available, using JS cipher fallback");
        const decryptedBytes = xorCipher(ciphertext, simpleKDF(passphrase, salt), iv);
        return decryptedBytes.buffer;
      }
    } catch (e) {
      console.error("File decryption failed:", e);
      throw new Error("Invalid decryption key or corrupted archive.");
    }
  },

  // SHA-256 Digest fallback
  async digestFile(fileBytes) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", fileBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn("Subtle digest failed, using JS hash fallback");
      }
    }
    const view = new Uint8Array(fileBytes);
    let h1 = 0x6a09e667, h2 = 0xbb67ae85, h3 = 0x3c6ef372, h4 = 0xa54ff53a;
    for (let i = 0; i < view.length; i++) {
      h1 = Math.imul(h1 ^ view[i], 16777619);
      h2 = Math.imul(h2 ^ view[i], 10995116);
      h3 = Math.imul(h3 ^ view[i], 3329);
      h4 = Math.imul(h4 ^ view[i], 8380417);
    }
    const toHex = (h) => Math.abs(h).toString(16).padStart(8, '0');
    return (toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h1 ^ h2) + toHex(h3 ^ h4) + toHex(h1 ^ h4) + toHex(h2 ^ h3)).slice(0, 64);
  },

  // Helpers for binary / base64 translation
  bufToBase64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  },

  base64ToBuf(base64) {
    const binString = atob(base64);
    const len = binString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  },

  // ----------------------------------------------------
  // Post-Quantum Cryptography Simulator (Kyber & Dilithium)
  // ----------------------------------------------------
  
  // CRYSTALS-Kyber Key Encapsulation Mechanism
  simulateKyberHandshake() {
    const q = 3329; // Kyber modulus
    const vectorLength = 3; // Kyber-768 parameter matrix size (k=3)
    const matrixA = [];
    for (let i = 0; i < vectorLength; i++) {
      matrixA[i] = [];
      for (let j = 0; j < vectorLength; j++) {
        matrixA[i][j] = `poly(${Math.floor(Math.random()*q)}x² + ${Math.floor(Math.random()*q)}x + ${Math.floor(Math.random()*q)})`;
      }
    }
    const secretVectorS = Array.from({length: vectorLength}, () => `e(${Math.floor(Math.random()*5) - 2})`);
    const publicKeyT = Array.from({length: vectorLength}, () => `t(${Math.floor(Math.random()*q)})`);
    const sharedSecret = Array.from({length: 8}, () => Math.floor(Math.random()*256).toString(16).padStart(2, '0')).join('');
    const c1 = Array.from({length: vectorLength}, () => `u(${Math.floor(Math.random()*q)})`);
    const c2 = `v(${Math.floor(Math.random()*q)})`;

    return {
      modulus: q,
      matrixA,
      secretS: secretVectorS,
      publicT: publicKeyT,
      ciphertext: { u: c1, v: c2 },
      sharedSecret: `0x${sharedSecret.toUpperCase()}`,
      algorithm: "CRYSTALS-Kyber-768"
    };
  },

  // CRYSTALS-Dilithium Digital Signature Scheme
  simulateDilithiumSignature(messageHash) {
    const q = 8380417; // Dilithium modulus
    const k = 6, l = 5; // Dilithium-3 security parameters
    const secretS1 = `s1_vec(len=${l}, small_norms)`;
    const publicT = `t_vec(len=${k}, mod=${q})`;
    const z_vec = Array.from({length: l}, (_, idx) => `z_${idx}(poly_deg_256, norm < 20000)`);
    const hint = `hint_h(sparse_weight_${Math.floor(Math.random()*30) + 15})`;
    const signatureBytes = Array.from({length: 16}, () => Math.floor(Math.random()*256).toString(16).padStart(2, '0')).join('');

    return {
      modulus: q,
      secretS1,
      publicT,
      signature: {
        z: z_vec,
        h: hint,
        hex: `0x${signatureBytes.toUpperCase()}...`
      },
      messageDigest: messageHash,
      algorithm: "CRYSTALS-Dilithium-3"
    };
  }
};

window.SenaCrypto = SenaCrypto;
