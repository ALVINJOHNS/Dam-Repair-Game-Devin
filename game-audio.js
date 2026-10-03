/*
 * DAM DEFENDER — procedural WebAudio soundtrack + SFX (window.DamAudio).
 *
 * No audio files ship with the game. Optional licensed-track mapping:
 *   window.DAM_AUDIO_TRACKS = { playing:'path', won:'path', lost:'path' }
 * Missing/empty entries or playback failure fall back to the original
 * synth score (original compositions, not recreations of any recording).
 * All sound routes through ONE master gain — mute covers everything.
 */
(function () {
  'use strict';

  var FADE = 0.5;           // crossfade seconds
  var MUSIC_VOL = 0.4;      // media track bus volume
  var _uid = 0;

  var DamAudio = {
    ctx: null,
    master: null,
    musicGain: null,        // synth bus (crossfaded)
    hissGain: null,
    rumbleGain: null,
    rumbleOsc: null,
    track: null,            // { el, gain, mode, id, fellBack }
    mode: 'silent',
    muted: false,
    _timer: null,
    _tick: 0,
    _nextT: 0,
    _noiseBuf: null,

    init: function () {
      if (this.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                       // graceful: no audio API
      try { this.ctx = new AC(); }
      catch (e) { this.ctx = null; return; }
      try {
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; return; }
      // ambient rumble (level set per mode)
      this.rumbleOsc = this.ctx.createOscillator();
      this.rumbleOsc.type = 'sine'; this.rumbleOsc.frequency.value = 48;
      this.rumbleGain = this.ctx.createGain();
      this.rumbleGain.gain.value = 0;
      this.rumbleOsc.connect(this.rumbleGain);
      this.rumbleGain.connect(this.master);
      this.rumbleOsc.start();
      // injection hiss bus
      var len = this.ctx.sampleRate;
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      var filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 0.7;
      this.hissGain = this.ctx.createGain();
      this.hissGain.gain.value = 0;
      src.connect(filt); filt.connect(this.hissGain);
      this.hissGain.connect(this.master);
      src.start();
    },

    resume: function () {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(function () {});
      }
    },

    setMuted: function (m) {
      this.muted = !!m;
      if (this.master) {
        this.master.gain.setTargetAtTime(
          this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
      }
      // media elements route through master — no per-element volume bypass
    },

    setFiring: function (on) {
      if (!this.ctx || !this.hissGain) return;
      this.hissGain.gain.setTargetAtTime(
        on ? 0.16 : 0, this.ctx.currentTime, 0.08);
    },

    // ---------------- licensed tracks ----------------
    _trackUrl: function (mode) {
      var T = window.DAM_AUDIO_TRACKS;
      return (T && T[mode]) ? T[mode] : null;
    },

    // Fade out + tear down whatever media is playing.
    _stopTrack: function () {
      var cur = this.track;
      if (!cur) return;
      this.track = null;
      var t = this.ctx ? this.ctx.currentTime : 0;
      try { cur.gain.gain.setTargetAtTime(0, t, 0.15); } catch (e) {}
      var el = cur.el, gain = cur.gain;
      setTimeout(function () {
        try { el.pause(); } catch (e) {}
        try { el.src = ''; } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      }, FADE * 1000 + 200);
    },

    // Begin licensed playback for mode. Returns true if a slot is configured;
    // async errors/rejection drop back to synth exactly once.
    _startTrack: function (mode) {
      var url = this._trackUrl(mode);
      if (!url || typeof Audio === 'undefined' || !this.ctx ||
          !this.ctx.createMediaElementSource) return false;
      var self = this;
      var el = new Audio();
      var entry = { el: el, gain: null, mode: mode, id: ++_uid, fellBack: false };
      this.track = entry;                     // identity BEFORE src/play

      function fail() {
        if (entry.fellBack) return;
        entry.fellBack = true;
        if (self.track === entry && self.mode === mode) {
          self._stopTrack();
          self._synthOn(mode);
        }
      }
      el.addEventListener('error', fail);
      el.addEventListener('stalled', fail);
      el.loop = (mode === 'playing');
      el.preload = 'auto';

      var src = this.ctx.createMediaElementSource(el);
      var gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(MUSIC_VOL,
        this.ctx.currentTime + FADE);
      src.connect(gain); gain.connect(this.master);
      entry.gain = gain;

      el.src = url;
      var p = el.play();
      if (p && p.catch) p.catch(fail);
      return true;
    },

    // ---------------- synth score ----------------
    PATTERNS: {
      playing: { bpm: 118, gain: 0.16,
        bass: [0, -1, 0, -1, 3, -1, 5, -1],
        arp:  [0, 3, 7, 12, 7, 3, 12, 15],
        hat:  [1, 0, 1, 0, 1, 0, 1, 1],
        root: 220, minor: false },
      won: { bpm: 96, gain: 0.18,
        bass: [0, -1, 7, -1, 12, -1, 7, -1],
        arp:  [0, 4, 7, 12, 16, 12, 7, 4],
        hat:  [0, 1, 0, 1, 0, 1, 0, 1],
        root: 262, minor: false },
      lost: { bpm: 60, gain: 0.14,
        bass: [0, -1, -1, -1, 3, -1, -1, -1],
        arp:  [0, -1, 3, -1, 7, -1, 3, -1],
        hat:  [0, 0, 0, 0, 0, 0, 0, 0],
        root: 196, minor: true }
    },

    _note: function (freq, t, dur, type, gv, dest) {
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gv, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(dest);
      o.onended = function () {            // avoid graph accumulation
        try { o.disconnect(); g.disconnect(); } catch (e) {}
      };
      o.start(t); o.stop(t + dur + 0.02);
    },
    _hat: function (t, gv, dest) {
      if (!this._noiseBuf) {
        var b = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1,
          this.ctx.sampleRate);
        var d = b.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this._noiseBuf = b;
      }
      var src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      var f = this.ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 5000;
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(gv, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(f); f.connect(g); g.connect(dest);
      src.onended = function () {
        try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) {}
      };
      src.start(t); src.stop(t + 0.08);
    },

    _startScheduler: function () {
      if (this._timer) return;              // only one scheduler ever
      var self = this;
      this._tick = 0;
      this._nextT = this.ctx.currentTime + 0.05;   // fresh grid per mode
      this._timer = setInterval(function () {
        if (!self.ctx || !self.musicGain) return;
        var pat = self.PATTERNS[self.mode];
        if (!pat) return;
        var now = self.ctx.currentTime;
        if (self._nextT < now) self._nextT = now + 0.05;
        var stepDur = 60 / pat.bpm / 2;
        while (self._nextT < now + 0.3) {
          var i = self._tick % 8;
          var t = self._nextT, g = self.musicGain;
          if (pat.bass[i] >= 0) {
            self._note(pat.root * Math.pow(2, pat.bass[i] / 12) / 2,
              t, stepDur * 0.9, 'triangle', pat.gain, g);
          }
          if (pat.arp[i] >= 0) {
            var semi = pat.minor && pat.arp[i] === 4 ? 3 : pat.arp[i];
            self._note(pat.root * Math.pow(2, semi / 12),
              t, stepDur * 0.8, 'sine', pat.gain * 0.7, g);
          }
          if (pat.hat[i]) self._hat(t, pat.gain * 0.35, g);
          self._tick++;
          self._nextT += stepDur;
        }
      }, 120);
    },
    _stopScheduler: function () {
      clearInterval(this._timer);
      this._timer = null; this._tick = 0;
    },
    _synthOn: function (mode) {
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      if (this.musicGain) {
        var old = this.musicGain;
        old.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(function () { try { old.disconnect(); } catch (e) {} },
          FADE * 1000 + 200);
      }
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(0, t);
      this.musicGain.gain.linearRampToValueAtTime(1, t + FADE);
      this.musicGain.connect(this.master);
      this._startScheduler();
    },
    _synthOff: function () {
      if (this.musicGain) {
        var t = this.ctx.currentTime;
        var old = this.musicGain;
        old.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(function () { try { old.disconnect(); } catch (e) {} },
          FADE * 1000 + 200);
        this.musicGain = null;
      }
      this._stopScheduler();
    },

    setMode: function (mode) {
      if (mode === this.mode) return;         // no duplicate re-init
      this.mode = mode;
      if (!this.ctx) return;

      // rumble only under musical modes
      if (this.rumbleGain) {
        this.rumbleGain.gain.setTargetAtTime(
          (mode === 'playing' || mode === 'won' || mode === 'lost')
            ? 0.045 : 0, this.ctx.currentTime, 0.2);
      }

      var musical = (mode === 'playing' || mode === 'won' || mode === 'lost');
      this._stopTrack();
      if (!musical) { this._synthOff(); return; }
      if (this._startTrack(mode)) {
        this._synthOff();
      } else {
        this._synthOn(mode);
      }
    },

    thud: function () {
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(this.master);
      o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
      o.start(t); o.stop(t + 0.4);
    },

    blip: function () {
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g); g.connect(this.master);
      o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
      o.start(t); o.stop(t + 0.22);
    },

    // read-only diagnostics for tests
    state: function () {
      return {
        mode: this.mode,
        muted: this.muted,
        ctxState: this.ctx ? this.ctx.state : 'none',
        scheduling: !!this._timer,
        schedulerCount: this._timer ? 1 : 0,
        masterGain: this.master ? this.master.gain.value : null,
        rumbleGain: this.rumbleGain ? this.rumbleGain.gain.value : null,
        trackSrc: this.track ? (this.track.el.currentSrc || this.track.el.src) : null,
        trackPaused: this.track ? this.track.el.paused : null,
        trackMode: this.track ? this.track.mode : null
      };
    }
  };

  window.DamAudio = DamAudio;
})();
