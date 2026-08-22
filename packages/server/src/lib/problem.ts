import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ProblemBody } from "@asimov/shared";

/** Throwable RFC 7807 error; the central error handler turns it into application/problem+json. */
export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(detail ?? title);
    this.name = "Problem";
  }
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  500: "Internal Server Error",
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
): void {
  const body: ProblemBody = {
    type: "about:blank",
    title,
    status,
    instance: request.url,
  };
  if (detail !== undefined) body.detail = detail;
  void reply.status(status).type("application/problem+json").send(body);
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof Problem) {
    send(request, reply, error.status, error.title, error.detail);
    return;
  }
  if (error.validation) {
    send(request, reply, 400, TITLES[400] ?? "Bad Request", error.message);
    return;
  }
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    request.log.error(error);
    send(request, reply, 500, TITLES[500] ?? "Internal Server Error");
    return;
  }
  send(request, reply, status, TITLES[status] ?? error.name, error.message);
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  send(request, reply, 404, "Not Found", `Route ${request.method} ${request.url} not found`);
}
