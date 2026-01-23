import type * as vscode from "vscode";

export function toAbortSignal(token?: vscode.CancellationToken): AbortSignal | undefined {
  if (!token) {
    return undefined;
  }

  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }

  return controller.signal;
}
