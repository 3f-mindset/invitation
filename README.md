# Invitation Presentation

## Local preview

```bash
npm run serve
```

The presentation will be available at `http://localhost:3000` and reloads the browser when files in `src/` change.

## Background music

The presentation plays a quiet, self-generating ambient music bed. It is
synthesized in the browser with the Web Audio API by `src/music-engine.js` —
there is no audio file and no external dependency.

- Music starts on the first click, key press, or touch (browsers block audio
  before a user gesture).
- The speaker button in the bottom controls mutes and unmutes it.
- Music pauses and resumes with the presentation, and fades out on the final
  slide.
- The composition is deterministic: a fixed seed in `MUSIC_DEFAULTS` produces
  the same piece every time.

## MP4 render

Install the Node dependency and Playwright's Chromium binary once:

```bash
npm install
npm run install:renderer
```

Then render the presentation to `rendered/presentation.mp4`:

```bash
npm run render:video
```

The renderer captures each slide at its presentation timing, hides the bottom controls, and retains the top progress bar. FFmpeg must be installed and available on your `PATH`.

The same generative music is rendered offline and muxed into the MP4 as an AAC
audio track. Set `VIDEO_AUDIO=0` to render a silent video instead.

Optional environment variables: `VIDEO_WIDTH`, `VIDEO_HEIGHT`, `VIDEO_FPS`, `FINAL_SLIDE_SECONDS`, `VIDEO_OUTPUT`, `VIDEO_AUDIO`, `RENDER_PORT`, and `PRESENTATION_URL`.
