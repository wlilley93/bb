interface FriendlyProviderError {
  title: string;
  detail: string | null;
}

const usageLimitPattern = /hit your\s+(?:(\w[\w-]*)\s+)?limit/iu;
const resetPattern = /resets?\s+(?:on\s+|at\s+|in\s+)?([^.\n"]+)/iu;
const imageInputPattern = /image inputs?\s+(?:are|is)\s+not supported/iu;
const httpPrefixPattern = /\bHTTP\s+(\d{3})\b/iu;

function structuredMessage(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return findMessage(parsed, 0);
  } catch {
    return null;
  }
}

function findMessage(value: unknown, depth: number): string | null {
  if (depth > 4 || typeof value !== "object" || value === null) {
    return null;
  }
  for (const key of ["message", "error", "detail", "data"]) {
    const next: unknown = Reflect.get(value, key);
    if (typeof next === "string" && next.trim() !== "") {
      const nested = structuredMessage(next);
      return nested ?? next.trim();
    }
    const nested = findMessage(next, depth + 1);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function sentence(value: string): string {
  const trimmed = value.trim().replace(/[\s.]+$/u, "");
  return trimmed === "" ? "" : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

export function friendlyProviderError(text: string): FriendlyProviderError | null {
  const limit = usageLimitPattern.exec(text);
  if (limit) {
    const window = limit[1] && limit[1].toLowerCase() !== "usage" ? `${limit[1].toLowerCase()} ` : "";
    const reset = resetPattern.exec(text)?.[1]?.trim().replace(/[\s.,]+$/u, "");
    return {
      title: "Usage limit reached",
      detail: reset
        ? `You've used up your ${window}limit for this provider. It resets ${reset}.`
        : `You've used up your ${window}limit for this provider.`,
    };
  }
  if (imageInputPattern.test(text)) {
    return {
      title: "This model can't read images",
      detail: "Remove the attached image, or switch to a model that supports image input.",
    };
  }
  const status = httpPrefixPattern.exec(text)?.[1];
  const extracted = structuredMessage(text);
  if (extracted !== null && (status !== undefined || text.trim().startsWith("{") || /^internal error/iu.test(text.trim()))) {
    return {
      title: status === undefined ? "Provider error" : `Provider rejected the request (HTTP ${status})`,
      detail: sentence(extracted),
    };
  }
  return null;
}
