/**
 * Sena-Secure Sound Effects Engine
 * Generates synthetic sounds using the browser Web Audio API.
 * Bypasses need for external file requests.
 */

const SenaAudio = {
  ctx: null,
  alarmInterval: null,
  ambientHum: null,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Web Audio API not supported on this browser.");
    }
  },

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  playClick() {
    this.resume();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  },

  playSuccess() {
    this.resume();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Pitch 1
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.frequency.setValueAtTime(880, now); // A5
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start();
    osc1.stop(now + 0.1);

    // Pitch 2 (slightly delayed)
    setTimeout(() => {
      if (!this.ctx) return;
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.frequency.setValueAtTime(1320, this.ctx.currentTime); // E6
      gain2.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start();
      osc2.stop(this.ctx.currentTime + 0.15);
    }, 80);
  },

  playFailure() {
    this.resume();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, this.ctx.currentTime + 0.25);

    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  },

  playTransmission() {
    this.resume();
    if (!this.ctx) return;

    const bufferSize = this.ctx.sampleRate * 0.3; // 0.3 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Fill buffer with white noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
  },

  startAlarm() {
    this.resume();
    if (!this.ctx || this.alarmInterval) return;

    // Siren sweeps up and down
    let rising = true;
    let freq = 400;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();

    this.alarmInterval = setInterval(() => {
      if (rising) {
        freq += 40;
        if (freq >= 800) rising = false;
      } else {
        freq -= 40;
        if (freq <= 400) rising = true;
      }
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    }, 50);

    // Keep reference to stop it later
    this.activeSirenOsc = osc;
    this.activeSirenGain = gain;
  },

  stopAlarm() {
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.activeSirenOsc) {
      try {
        this.activeSirenGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
        const oscToStop = this.activeSirenOsc;
        setTimeout(() => oscToStop.stop(), 150);
      } catch (e) {}
      this.activeSirenOsc = null;
      this.activeSirenGain = null;
    }
  },

  startAmbientHum() {
    this.resume();
    if (!this.ctx || this.ambientHum) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, this.ctx.currentTime); // Low A hum
    
    gain.gain.setValueAtTime(0.015, this.ctx.currentTime); // Quiet background

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();

    this.ambientHum = { osc, gain };
  },

  stopAmbientHum() {
    if (this.ambientHum) {
      try {
        this.ambientHum.gain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.ambientHum.osc.stop();
      } catch (e) {}
      this.ambientHum = null;
    }
  }
};

window.SenaAudio = SenaAudio;
