import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function apiError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: { message, code: code ?? httpCode(status) } }, { status });
}

function httpCode(status: number) {
  return (
    {
      400: "bad_request",
      401: "unauthorized",
      403: "forbidden",
      404: "not_found",
      409: "conflict",
      422: "unprocessable",
      429: "rate_limited",
      500: "internal_error",
    }[status] ?? "error"
  );
}

/** Wrap a route handler so thrown errors become clean JSON instead of HTML. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return apiError(err.status, err.message, err.code);
      console.error("[api] unhandled error", err);
      return apiError(500, "Something went wrong");
    }
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
