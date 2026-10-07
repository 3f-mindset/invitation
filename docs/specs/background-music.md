# Spec: Generative Background Music

Status: draft
Owner: orchestrator
Date: 2026-10-07

## Goal

Add a quiet, inspirational, self-generating ambient music bed to the invitation
presentation. The music is synthesized in the browser with the Web Audio API
(no binary assets, no runtime dependencies) and is also muxed into the rendered
`rendered/presentation.mp4` as an audio track.

## User-visible behavior

- On the first user gesture (click, key press, or touch) the music fades in
  quietly and loops/continues for the life of the presentation.
- A sound toggle button in the bottom controls lets the viewer mute and unmute.
  The toggle reflects the current state visually and via `aria-pressed`.
- Music pauses when the presentation pauses (play button, tab hidden, scrubber)
  and resumes when the presentation resumes.
- When the presentation reaches the final QR slide / completes, the music fades
  out over a few seconds.
- The rendered MP4 contains the same music as an AAC audio track whose duration
  matches the video.

## Non-goals

- MIDI file playback or any binary audio asset.
- Music that reacts to slide text, slide timing, or playback speed.
- Persisting the mute preference across reloads.
- Multiple tracks or user-selectable songs.
- Any change to slide timing, telemetry semantics, or the source editor.

## Architecture decision

The music engine lives in a new ES module `src/music-engine.js` so the exact
same deterministic composition can be used by both the browser (Web Audio
realtime) and the Node video renderer (pure-JS offline synthesis). The page
loads it with `<script type="module" src="music-engine.js"></script>`. The
GitHub Pages workflow copies all of `src/`, so the sibling file deploys
correctly.

The module exports:

- `MUSIC_DEFAULTS` — seed, root, scale, chord progression, tempo, gains.
- `buildMusicSchedule({ seed, durationMs })` — pure, deterministic event list
  (`{ time, type: "pad" | "bell" | "bass", freq, duration, gain, pan }`).
- `scheduleMusic(context, destination, schedule, { startTime, gain })` —
  schedules Web Audio nodes; returns a handle with `stop()`.
- `renderScheduleToWav(schedule, { sampleRate, channels })` — pure-JS additive
  synthesis returning a 16-bit PCM WAV `Uint8Array` (Node-compatible).
- `encodeWav(channelData, sampleRate)` — WAV container helper.

The browser and Node synthesizers share the composition (schedule) but not the
sample-level DSP. Determinism is guaranteed for the Node renderer (same seed →
byte-identical WAV); the browser version is the same notes and envelopes.

## Acceptance criteria

1. **Gesture start**
   Given the page is loaded and not in `paused=1` mode,
   when the viewer first clicks, presses a key, or touches the page,
   then music fades in and the sound toggle shows the "on" state.

2. **Toggle mute/unmute**
   Given music is playing,
   when the viewer clicks the sound toggle,
   then audio is muted and `aria-pressed` becomes `false`;
   when clicked again, audio is unmuted and `aria-pressed` becomes `true`.

3. **Pause/resume coupling**
   Given music is playing,
   when the presentation is paused (play button, `visibilitychange` to hidden,
   or scrubber input),
   then music pauses;
   when the presentation resumes,
   then music resumes.

4. **Final slide fade-out**
   Given the presentation reaches the final QR slide or completes,
   then music fades out over ~4s and stops.

5. **Render mode is silent**
   Given the page is loaded with `#slide=N&paused=1` (the video renderer's mode)
   or no user gesture has occurred,
   then no audio is produced and no console errors are logged.

6. **MP4 contains audio**
   Given `npm run render:video` completes successfully,
   then `rendered/presentation.mp4` has an AAC audio stream whose duration is
   within 0.5s of the video stream duration, and the video stream is unchanged
   (same frames/timing as before).

7. **Graceful fallback**
   Given the offline audio render fails or is disabled (`VIDEO_AUDIO=0`),
   when rendering video,
   then the render still succeeds with a silent video and logs a warning.

8. **Deterministic offline audio**
   Given the same seed and duration,
   when `renderScheduleToWav` is called twice,
   then the two WAV byte arrays are identical.

9. **No new assets or dependencies**
   Given the change is applied,
   then no binary files are added, `package.json` dependencies are unchanged,
   and the page makes no new network requests.

10. **Existing behavior preserved**
    Given the change is applied,
    then slide timing, controls, telemetry, source editor, and video frame
    capture behave exactly as before.

## Constraints

- Single-page presentation; no new runtime dependencies.
- No committed binary assets.
- Must not throw or produce audio when autoplay is blocked.
- Music must stay quiet (background level, roughly -16 dBFS peak).
- Deterministic seeded PRNG (mulberry32) for reproducibility.
- Offline render must not require a user gesture (OfflineAudioContext).

## Assumptions

- `ASSUMPTION:` Music tempo is independent of the presentation playback speed.
- `ASSUMPTION:` The mute preference is not persisted across reloads.
- `ASSUMPTION:` Music fades out at the final slide rather than continuing.
- `ASSUMPTION:` A single fixed seed constant is used; it is exposed in
  `MUSIC_DEFAULTS` for reproducibility.
- `ASSUMPTION:` MP4 audio is AAC at 192 kbps, muxed with `-shortest`.
- `ASSUMPTION:` The offline render duration equals the sum of slide timings
  (the same value the renderer already computes).
- `ASSUMPTION:` Music telemetry is limited to `music_enabled` / `music_disabled`
  events, consistent with the existing telemetry pattern.

## Open questions

- None blocking. All resolved decisions are recorded above.
