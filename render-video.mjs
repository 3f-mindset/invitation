import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildMusicSchedule, renderScheduleToWav } from "./src/music-engine.js";

const rootDirectory =
    path.dirname(
        fileURLToPath(
            import.meta.url
        )
    );

function readPositiveInteger(
    name,
    fallback
) {
    const value = Number(
        process.env[name] ||
        fallback
    );

    if (
        !Number.isInteger(value) ||
        value <= 0
    ) {
        throw new Error(
            `${name} must be a positive integer.`
        );
    }

    return value;
}

function readPositiveNumber(
    name,
    fallback
) {
    const value = Number(
        process.env[name] ||
        fallback
    );

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {
        throw new Error(
            `${name} must be a positive number.`
        );
    }

    return value;
}

const settings = {
    audioEnabled:
        process.env.VIDEO_AUDIO !== "0",

    finalSlideDurationMs:
        readPositiveNumber(
            "FINAL_SLIDE_SECONDS",
            6
        ) *
        1000,

    framesPerSecond:
        readPositiveInteger(
            "VIDEO_FPS",
            30
        ),

    height:
        readPositiveInteger(
            "VIDEO_HEIGHT",
            1080
        ),

    outputPath:
        path.resolve(
            rootDirectory,
            process.env.VIDEO_OUTPUT ||
            "rendered/presentation.mp4"
        ),

    port:
        readPositiveInteger(
            "RENDER_PORT",
            4173
        ),

    width:
        readPositiveInteger(
            "VIDEO_WIDTH",
            1920
        )
};

const externalPresentationUrl =
    process.env.PRESENTATION_URL;

const renderStyles = `
    #bottomChrome {
        display: none !important;
    }

    .slide {
        transition: none !important;
    }

    #floatingApplication {
        top: 48px;
        right: 30px;

        flex-direction: column;

        align-items: center;
        justify-content: center;

        gap: 12px;

        width: min(360px, calc(100vw - 60px));

        max-width: none;

        padding: 10px;

        border-radius: 24px;
    }

    #floatingQrWrap {
        width: 320px;
        height: 320px;

        flex-basis: 320px;

        padding: 16px;

        border-radius: 22px;
    }

    #floatingApplicationLabel {
        font-size: 13px;

        text-align: center;
    }

    #floatingApplicationButton {
        width: 100%;
        min-height: 48px;

        padding: 10px 14px;

        font-size: 14px;

        border-radius: 8px;
    }
`;

function assertFfmpegIsAvailable() {
    const result = spawnSync(
        "ffmpeg",
        [
            "-version"
        ],
        {
            stdio: "ignore"
        }
    );

    if (
        result.error ||
        result.status !== 0
    ) {
        throw new Error(
            "FFmpeg is required. Install it and ensure `ffmpeg` is on your PATH."
        );
    }
}

function createSlideUrl(
    presentationUrl,
    slideNumber
) {
    const url =
        new URL(
            presentationUrl
        );

    url.hash =
        `slide=${slideNumber}&paused=1`;

    return url.toString();
}

function startLocalServer() {
    const server = spawn(
        process.execPath,
        [
            "serve.js"
        ],
        {
            cwd: rootDirectory,
            env: {
                ...process.env,
                PORT: String(
                    settings.port
                )
            },
            stdio: [
                "ignore",
                "ignore",
                "pipe"
            ]
        }
    );

    let errorOutput = "";

    server.stderr.on(
        "data",
        chunk => {
            errorOutput +=
                chunk.toString();
        }
    );

    return {
        errorOutput: () =>
            errorOutput.trim(),
        process: server,
        url: `http://localhost:${settings.port}`
    };
}

async function waitForServer(
    url,
    server
) {
    const deadline =
        Date.now() +
        10000;

    while (
        Date.now() <
        deadline
    ) {
        if (
            server.process.exitCode !==
            null
        ) {
            throw new Error(
                server.errorOutput() ||
                "The local presentation server stopped before it was ready."
            );
        }

        try {
            const response =
                await fetch(
                    url
                );

            if (
                response.ok
            ) {
                return;
            }
        } catch {
            // The server is still starting.
        }

        await delay(
            100
        );
    }

    throw new Error(
        "Timed out waiting for the local presentation server."
    );
}

async function stopLocalServer(
    server
) {
    if (
        !server ||
        server.exitCode !==
        null
    ) {
        return;
    }

    server.kill(
        "SIGTERM"
    );

    await Promise.race(
        [
            once(
                server,
                "exit"
            ),
            delay(
                2000
            )
        ]
    );
}

async function waitForSlideToSettle(
    page,
    slideNumber
) {
    await page.waitForFunction(
        expectedSlideNumber => {
            const activeSlide =
                document.querySelector(
                    "#stage .slide.active"
                );

            const counter =
                document.getElementById(
                    "counter"
                );

            const displayedSlideNumber =
                Number(
                    counter.textContent.split(
                        "/"
                    )[
                    0
                    ].trim()
                );

            return (
                activeSlide &&
                displayedSlideNumber ===
                expectedSlideNumber &&
                Number(
                    getComputedStyle(
                        activeSlide
                    ).opacity
                ) >
                0.98
            );
        },
        slideNumber,
        {
            timeout: 5000
        }
    );

    await page.evaluate(
        async () => {
            if (
                document.fonts
            ) {
                await document.fonts.ready;
            }
        }
    );

    await page.waitForFunction(
        () =>
            Array.from(
                document.images
            ).every(
                image =>
                    image.complete
            ),
        {
            timeout: 5000
        }
    ).catch(
        () => {
            // An external QR image should not prevent the export.
        }
    );
}

async function moveToSlide(
    page,
    slideNumber
) {
    await page.evaluate(
        nextSlideNumber => {
            window.location.hash =
                `slide=${nextSlideNumber}&paused=1`;
        },
        slideNumber
    );
}

async function getSlideTimings(
    page
) {
    return page.evaluate(
        finalSlideDurationMs => {
            const timings =
                window.getPresentationSlideTimings();

            return timings.map(
                (
                    timing,
                    index
                ) => ({
                    durationMs:
                        Number.isFinite(
                            timing.delay
                        )
                            ? timing.delay
                            : finalSlideDurationMs,
                    slideNumber:
                        index +
                        1
                })
            );
        },
        settings.finalSlideDurationMs
    );
}

function quoteConcatPath(
    filePath
) {
    return (
        "'" +
        filePath.replaceAll(
            "'",
            "'\\''"
        ) +
        "'"
    );
}

async function writeConcatManifest(
    frames,
    manifestPath
) {
    const entries =
        frames.flatMap(
            frame => [
                `file ${quoteConcatPath(frame.path)}`,
                `duration ${(
                    frame.durationMs / 1000
                ).toFixed(3)}`
            ]
        );

    entries.push(
        `file ${quoteConcatPath(
            frames.at(
                -1
            ).path
        )}`
    );

    await writeFile(
        manifestPath,
        entries.join(
            "\n"
        ) +
        "\n"
    );
}

async function runFfmpeg(
    manifestPath,
    audioPath
) {
    await mkdir(
        path.dirname(
            settings.outputPath
        ),
        {
            recursive: true
        }
    );

    const argumentsList = audioPath
        ? [
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", manifestPath,
            "-i", audioPath,
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-vf", `fps=${settings.framesPerSecond},format=yuv420p`,
            "-c:v", "libx264",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            settings.outputPath
        ]
        : [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            manifestPath,
            "-vf",
            `fps=${settings.framesPerSecond},format=yuv420p`,
            "-c:v",
            "libx264",
            "-movflags",
            "+faststart",
            settings.outputPath
        ];

    await new Promise(
        (
            resolve,
            reject
        ) => {
            const ffmpeg = spawn(
                "ffmpeg",
                argumentsList,
                {
                    stdio: "inherit"
                }
            );

            ffmpeg.once(
                "error",
                reject
            );

            ffmpeg.once(
                "exit",
                code => {
                    if (
                        code ===
                        0
                    ) {
                        resolve();
                        return;
                    }

                    reject(
                        new Error(
                            `FFmpeg exited with code ${code}.`
                        )
                    );
                }
            );
        }
    );
}

async function main() {
    assertFfmpegIsAvailable();

    const localServer =
        externalPresentationUrl
            ? null
            : startLocalServer();

    const presentationUrl =
        externalPresentationUrl ||
        localServer.url;

    const temporaryDirectory =
        await mkdtemp(
            path.join(
                os.tmpdir(),
                "presentation-video-"
            )
        );

    let browser;

    try {
        if (
            localServer
        ) {
            await waitForServer(
                presentationUrl,
                localServer
            );
        }

        browser =
            await chromium.launch({
                headless: true
            });

        const context =
            await browser.newContext({
                deviceScaleFactor: 1,
                viewport: {
                    height: settings.height,
                    width: settings.width
                }
            });

        const page =
            await context.newPage();

        await page.goto(
            createSlideUrl(
                presentationUrl,
                1
            ),
            {
                waitUntil: "domcontentloaded"
            }
        );

        await page.addStyleTag({
            content: renderStyles
        });

        await waitForSlideToSettle(
            page,
            1
        );

        const timings =
            await getSlideTimings(
                page
            );

        if (
            timings.length ===
            0
        ) {
            throw new Error(
                "No presentation slides were found."
            );
        }

        const totalDurationMs =
            timings.reduce(
                (sum, timing) => sum + timing.durationMs,
                0
            );

        let audioPath = null;

        if (settings.audioEnabled) {
            try {
                const schedule =
                    buildMusicSchedule({
                        durationMs: totalDurationMs
                    });

                const wav =
                    renderScheduleToWav(
                        schedule,
                        {
                            sampleRate: 44100,
                            channels: 2
                        }
                    );

                audioPath =
                    path.join(
                        temporaryDirectory,
                        "music.wav"
                    );

                await writeFile(
                    audioPath,
                    wav
                );

                console.log(
                    `Rendered ${(wav.length / 1048576).toFixed(1)} MB of background music.`
                );
            } catch (error) {
                console.warn(
                    `Background music render failed; continuing without audio: ${error.message}`
                );

                audioPath = null;
            }
        }

        const frames =
            [];

        for (
            const timing of timings
        ) {
            const framePath =
                path.join(
                    temporaryDirectory,
                    `slide-${String(
                        timing.slideNumber
                    ).padStart(
                        4,
                        "0"
                    )}.png`
                );

            if (
                timing.slideNumber >
                1
            ) {
                await moveToSlide(
                    page,
                    timing.slideNumber
                );
            }

            await waitForSlideToSettle(
                page,
                timing.slideNumber
            );

            await page.locator(
                "#app"
            ).screenshot({
                path: framePath
            });

            frames.push({
                ...timing,
                path: framePath
            });

            console.log(
                `Captured slide ${timing.slideNumber} of ${timings.length}.`
            );
        }

        const manifestPath =
            path.join(
                temporaryDirectory,
                "slides.txt"
            );

        await writeConcatManifest(
            frames,
            manifestPath
        );

        await runFfmpeg(
            manifestPath,
            audioPath
        );

        console.log(
            `Created ${settings.outputPath}`
        );
    } finally {
        await browser?.close();
        await stopLocalServer(
            localServer?.process
        );
        await rm(
            temporaryDirectory,
            {
                force: true,
                recursive: true
            }
        );
    }
}

main().catch(
    error => {
        console.error(
            `Video render failed: ${error.message}`
        );
        process.exitCode =
            1;
    }
);
