export function normalizePageUrl(rawUrl: string): string {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid page URL: ${rawUrl}`);
  }

  url.hash = "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
