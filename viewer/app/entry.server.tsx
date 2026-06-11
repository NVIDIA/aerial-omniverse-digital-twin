/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { PassThrough } from "node:stream";

const ABORT_DELAY = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();

          const stream = new ReadableStream({
            start(controller) {
              body.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
              });
              body.on("end", () => {
                controller.close();
              });
            },
            cancel() {
              abort();
            },
          });

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },

        onShellError(error: unknown) {
          reject(error);
        },

        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error("[Server Render] Error during streaming:", error);
          }
        },
      } as RenderToPipeableStreamOptions,
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
