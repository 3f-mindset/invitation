// Deterministic generative ambient music engine.
// Works in the browser (Web Audio API) and in Node (pure JS offline synthesis).

export const MUSIC_DEFAULTS = {
  seed: 0x5eed1a7e,
  sampleRate: 44100,
  channels: 2,
  rootHz: 110,
  scale: [0, 2, 3, 5, 7, 8, 10],
  chordProgression: [
    [0, 3, 7],
    [5, 8, 12],
    [3, 7, 10],
    [7, 10, 14]
  ],
  chordDurationSec: 16,
  bellMinGapSec: 3,
  bellMaxGapSec: 9,
  masterGain: 0.16,
  fadeInSec: 3,
  fadeOutSec: 4,
  reverbSeconds: 3.5,
  reverbDecay: 2.5
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function freqFor(rootHz, semitones) {
  return rootHz * Math.pow(2, semitones / 12);
}

export function buildMusicSchedule({ seed = MUSIC_DEFAULTS.seed, durationMs } = {}) {
  const durationSec = Math.max(0, (durationMs || 0) / 1000);
  const rand = mulberry32(seed);
  const events = [];

  const pushEvent = (event) => {
    if (event.time >= durationSec) return;
    const duration = Math.min(event.duration, durationSec - event.time);
    if (duration <= 0) return;
    events.push({ ...event, duration });
  };

  const chordCount = Math.ceil(durationSec / MUSIC_DEFAULTS.chordDurationSec);
  for (let i = 0; i < chordCount; i++) {
    const time = i * MUSIC_DEFAULTS.chordDurationSec;
    const chord = MUSIC_DEFAULTS.chordProgression[i % MUSIC_DEFAULTS.chordProgression.length];

    for (let t = 0; t < chord.length; t++) {
      const spread = chord.length > 1 ? (t - (chord.length - 1) / 2) / ((chord.length - 1) / 2) : 0;
      pushEvent({
        time,
        type: "pad",
        freq: freqFor(MUSIC_DEFAULTS.rootHz, chord[t]),
        duration: MUSIC_DEFAULTS.chordDurationSec * 1.2,
        gain: 0.1,
        pan: spread * 0.4
      });
    }

    pushEvent({
      time,
      type: "bass",
      freq: freqFor(MUSIC_DEFAULTS.rootHz, chord[0] - 12),
      duration: MUSIC_DEFAULTS.chordDurationSec,
      gain: 0.12,
      pan: 0
    });
  }

  let bellTime = 0;
  while (true) {
    const gap =
      MUSIC_DEFAULTS.bellMinGapSec +
      rand() * (MUSIC_DEFAULTS.bellMaxGapSec - MUSIC_DEFAULTS.bellMinGapSec);
    bellTime += gap;
    if (bellTime >= durationSec) break;

    const degree = MUSIC_DEFAULTS.scale[Math.floor(rand() * MUSIC_DEFAULTS.scale.length)];
    const octave = 1 + Math.floor(rand() * 2);
    pushEvent({
      time: bellTime,
      type: "bell",
      freq: freqFor(MUSIC_DEFAULTS.rootHz, degree + 12 * octave),
      duration: 2.5 + rand() * 1.5,
      gain: 0.08,
      pan: -0.6 + rand() * 1.2
    });
  }

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.freq - b.freq;
  });

  return { durationMs: durationMs || 0, events };
}

function makeImpulseResponse(context, seconds, decay, seed) {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(seconds * rate));
  const buffer = context.createBuffer(2, length, rate);
  const rand = mulberry32(seed);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const envelope = Math.pow(1 - i / length, decay);
      data[i] = (rand() * 2 - 1) * envelope;
    }
  }
  return buffer;
}

export function scheduleMusic(context, destination, schedule, { startTime = 0, gain = 1 } = {}) {
  const master = context.createGain();
  master.gain.value = gain;
  master.connect(destination);

  const convolver = context.createConvolver();
  convolver.buffer = makeImpulseResponse(
    context,
    MUSIC_DEFAULTS.reverbSeconds,
    MUSIC_DEFAULTS.reverbDecay,
    MUSIC_DEFAULTS.seed ^ 0x9e3779b9
  );
  const wet = context.createGain();
  wet.gain.value = 0.25;
  convolver.connect(wet);
  wet.connect(master);

  const oscillators = [];

  const connectVoice = (env, pan) => {
    if (pan) {
      env.connect(pan);
      pan.connect(master);
      pan.connect(convolver);
    } else {
      env.connect(master);
      env.connect(convolver);
    }
  };

  const makePanner = (pan) => {
    if (typeof context.createStereoPanner !== "function") return null;
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    return panner;
  };

  for (const event of schedule.events) {
    const t0 = startTime + event.time;
    const env = context.createGain();
    env.gain.value = 0;
    const pan = makePanner(event.pan);
    connectVoice(env, pan);

    if (event.type === "pad") {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      filter.connect(env);

      const osc1 = context.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.value = event.freq;
      osc1.detune.value = -4;
      const osc2 = context.createOscillator();
      osc2.type = "sawtooth";
      osc2.frequency.value = event.freq;
      osc2.detune.value = 4;
      osc1.connect(filter);
      osc2.connect(filter);

      const attack = Math.min(2, event.duration * 0.3);
      const release = Math.min(3, event.duration * 0.4);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(event.gain, t0 + attack);
      env.gain.setValueAtTime(event.gain, t0 + Math.max(attack, event.duration - release));
      env.gain.linearRampToValueAtTime(0, t0 + event.duration);

      osc1.start(t0);
      osc2.start(t0);
      oscillators.push(osc1, osc2);
    } else if (event.type === "bell") {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = event.freq;
      osc.connect(env);

      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(event.gain, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + event.duration);

      osc.start(t0);
      oscillators.push(osc);
    } else {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = event.freq;
      osc.connect(env);

      const attack = Math.min(1.5, event.duration * 0.3);
      const release = Math.min(2, event.duration * 0.4);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(event.gain, t0 + attack);
      env.gain.setValueAtTime(event.gain, t0 + Math.max(attack, event.duration - release));
      env.gain.linearRampToValueAtTime(0, t0 + event.duration);

      osc.start(t0);
      oscillators.push(osc);
    }
  }

  return {
    stop(fadeOutSec = MUSIC_DEFAULTS.fadeOutSec) {
      const now = context.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + fadeOutSec);
      } catch (err) {
        // Scheduling is best-effort; never throw on a suspended context.
      }
      for (const osc of oscillators) {
        try {
          osc.stop(now + fadeOutSec + 0.05);
        } catch (err) {
          // Already stopped or context closed.
        }
      }
    }
  };
}

function envelope(t, duration, attack, release) {
  if (t < attack) return attack > 0 ? t / attack : 1;
  if (t > duration - release) {
    return release > 0 ? Math.max(0, (duration - t) / release) : 0;
  }
  return 1;
}

export function renderScheduleToWav(
  schedule,
  { sampleRate = MUSIC_DEFAULTS.sampleRate, channels = MUSIC_DEFAULTS.channels } = {}
) {
  const durationSec =
    schedule.durationMs > 0
      ? schedule.durationMs / 1000
      : schedule.events.reduce((max, e) => Math.max(max, e.time + e.duration), 0);
  const totalSamples = Math.max(1, Math.ceil(durationSec * sampleRate));
  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(new Float32Array(totalSamples));

  const twoPi = Math.PI * 2;
  const padAlpha = 1 - Math.exp((-twoPi * 1200) / sampleRate);

  for (const event of schedule.events) {
    const start = Math.max(0, Math.floor(event.time * sampleRate));
    const end = Math.min(totalSamples, Math.ceil((event.time + event.duration) * sampleRate));
    if (end <= start) continue;

    const angle = ((clamp(event.pan, -1, 1) + 1) * Math.PI) / 4;
    const panL = Math.cos(angle);
    const panR = Math.sin(angle);

    if (event.type === "pad") {
      const attack = Math.min(2, event.duration * 0.3);
      const release = Math.min(3, event.duration * 0.4);
      const f1 = event.freq * Math.pow(2, -4 / 1200);
      const f2 = event.freq * Math.pow(2, 4 / 1200);
      let lp = 0;
      for (let i = start; i < end; i++) {
        const t = (i - start) / sampleRate;
        const env = envelope(t, event.duration, attack, release);
        const raw = (Math.sin(twoPi * f1 * t) + Math.sin(twoPi * f2 * t)) * 0.5;
        lp += padAlpha * (raw - lp);
        const sample = lp * env * event.gain;
        for (let c = 0; c < channels; c++) {
          channelData[c][i] += sample * (c === 0 ? panL : panR);
        }
      }
    } else if (event.type === "bell") {
      const attack = 0.01;
      const tau = event.duration / 5;
      for (let i = start; i < end; i++) {
        const t = (i - start) / sampleRate;
        const env = t < attack ? t / attack : Math.exp(-t / tau);
        const sample = Math.sin(twoPi * event.freq * t) * env * event.gain;
        for (let c = 0; c < channels; c++) {
          channelData[c][i] += sample * (c === 0 ? panL : panR);
        }
      }
    } else {
      const attack = Math.min(1.5, event.duration * 0.3);
      const release = Math.min(2, event.duration * 0.4);
      for (let i = start; i < end; i++) {
        const t = (i - start) / sampleRate;
        const env = envelope(t, event.duration, attack, release);
        const sample = Math.sin(twoPi * event.freq * t) * env * event.gain;
        for (let c = 0; c < channels; c++) {
          channelData[c][i] += sample * (c === 0 ? panL : panR);
        }
      }
    }
  }

  const delayTimes = [0.13, 0.19];
  const feedback = 0.35;
  const wet = 0.18;
  for (let c = 0; c < channels; c++) {
    const dry = channelData[c];
    const delaySamples = Math.max(1, Math.round(delayTimes[c % delayTimes.length] * sampleRate));
    const delayed = new Float32Array(totalSamples);
    for (let i = delaySamples; i < totalSamples; i++) {
      delayed[i] = dry[i - delaySamples] + feedback * delayed[i - delaySamples];
      dry[i] += wet * delayed[i];
    }
  }

  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const data = channelData[c];
    for (let i = 0; i < totalSamples; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak > 0) {
    const scale = MUSIC_DEFAULTS.masterGain / peak;
    for (let c = 0; c < channels; c++) {
      const data = channelData[c];
      for (let i = 0; i < totalSamples; i++) data[i] *= scale;
    }
  }

  return encodeWav(channelData, sampleRate);
}

export function encodeWav(channelData, sampleRate) {
  const channels = channelData.length;
  const frames = channels > 0 ? channelData[0].length : 0;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataLength = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const value = clamp(channelData[c][i], -1, 1);
      view.setInt16(offset, Math.round(value * 32767), true);
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(buffer);
}

if (typeof window !== "undefined") {
  window.MusicEngine = { MUSIC_DEFAULTS, buildMusicSchedule, scheduleMusic, renderScheduleToWav, encodeWav };
}
