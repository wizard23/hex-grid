/** every successful response body: { data: ... } */
export interface Envelope<T> {
  data: T;
}

/** RFC 7807 application/problem+json body (all members optional per spec) */
export interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
}
