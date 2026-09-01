# Invitation Presentation

## Local preview

```bash
npm run serve
```

The presentation will be available at `http://localhost:3000` and reloads the browser when files in `src/` change.

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

Optional environment variables: `VIDEO_WIDTH`, `VIDEO_HEIGHT`, `VIDEO_FPS`, `FINAL_SLIDE_SECONDS`, `VIDEO_OUTPUT`, `RENDER_PORT`, and `PRESENTATION_URL`.
