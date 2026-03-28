/**
 * Parses a non-OK fetch Response into a human-readable error string.
 * Reads `body.detail` if present; falls back to a generic message.
 * Users must never see raw JSON, a stack trace, or an HTTP status code.
 */
export async function parseApiError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body?.detail) return body.detail;
    return "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
  }
}
