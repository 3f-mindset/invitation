#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = "localhost";
const port = Number(process.env.PORT || 3000);
const sourceDirectory = path.join(__dirname, "src");

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

const server = http.createServer((request, response) => {
    const requestUrl = new URL(
        request.url,
        `http://${host}`
    );

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

        response.writeHead(200, {
            "Content-Type":
                contentTypes[
                    path.extname(filePath).toLowerCase()
                ] ||
                "application/octet-stream"
        });
        response.end(file);
    });
});

server.listen(port, host, () => {
    const url = `http://${host}:${port}`;

    console.log(`Serving src/ at ${url}`);
    console.log(`Port: ${port}`);
});
