#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = "localhost";
const port = Number(process.env.PORT || 3000);
const sourceDirectory = path.join(__dirname, "src");
const reloadClients = new Set();

let reloadTimer = null;

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
};

const reloadClientScript = `
<script>
    const presentationReloadEvents = new EventSource("/__reload");

    presentationReloadEvents.addEventListener("message", () => {
        window.location.reload();
    });
</script>`;

function injectLiveReloadClient(file) {
    const html = file.toString("utf8");

    return html.replace(
        /<\/body>/i,
        `${reloadClientScript}</body>`
    );
}

function addReloadClient(response) {
    response.writeHead(200, {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream"
    });
    response.write("retry: 1000\n\n");
    reloadClients.add(response);

    response.on("close", () => {
        reloadClients.delete(response);
    });
}

function reloadConnectedBrowsers() {
    reloadTimer = null;

    for (const response of reloadClients) {
        response.write("data: reload\n\n");
    }

    if (reloadClients.size > 0) {
        console.log("Change detected. Reloading connected browser(s).");
    }
}

function scheduleBrowserReload() {
    clearTimeout(reloadTimer);

    reloadTimer = setTimeout(
        reloadConnectedBrowsers,
        80
    );
}

const server = http.createServer((request, response) => {
    const requestUrl = new URL(
        request.url,
        `http://${host}`
    );

    if (requestUrl.pathname === "/__reload") {
        addReloadClient(response);
        return;
    }

    const requestedPath =
        requestUrl.pathname === "/"
            ? "/index.htm"
            : requestUrl.pathname;

    const filePath = path.resolve(
        sourceDirectory,
        `.${decodeURIComponent(requestedPath)}`
    );

    if (
        filePath !== sourceDirectory &&
        !filePath.startsWith(
            sourceDirectory + path.sep
        )
    ) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, file) => {
        if (error) {
            response.writeHead(
                error.code === "ENOENT" ? 404 : 500,
                {
                    "Content-Type": "text/plain; charset=utf-8"
                }
            );
            response.end(
                error.code === "ENOENT"
                    ? "Not found"
                    : "Server error"
            );
            return;
        }

        const extension =
            path.extname(filePath).toLowerCase();

        const isHtml =
            extension === ".htm" ||
            extension === ".html";

        response.writeHead(200, {
            "Cache-Control": "no-cache",
            "Content-Type":
                contentTypes[
                    extension
                ] ||
                "application/octet-stream"
        });
        response.end(
            isHtml
                ? injectLiveReloadClient(file)
                : file
        );
    });
});

fs.watch(
    sourceDirectory,
    {
        recursive: true
    },
    scheduleBrowserReload
);

server.listen(port, host, () => {
    const url = `http://${host}:${port}`;

    console.log(`Serving src/ at ${url}`);
    console.log(`Port: ${port}`);
    console.log("Watching src/ for changes with hot reload enabled.");
});
