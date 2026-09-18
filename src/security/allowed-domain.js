const EXACT_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeAllowedDomain(value) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  const hostname = normalized.startsWith('*.') ? normalized.slice(2) : normalized;

  if (!EXACT_HOST_PATTERN.test(hostname) || !hostname.includes('.')) {
    throw new Error(`Invalid allowed domain: ${value}`);
  }

  return normalized.startsWith('*.') ? `*.${hostname}` : hostname;
}

export function normalizeAllowedDomains(values) {
  return [...new Set(values.map(normalizeAllowedDomain))];
}

export function isHostnameAllowed(hostname, allowedDomains) {
  const candidate = hostname.toLowerCase().replace(/\.$/, '');

  return allowedDomains.some((pattern) => {
    if (!pattern.startsWith('*.')) return candidate === pattern;
    const suffix = pattern.slice(1);
    return candidate.endsWith(suffix) && candidate.length > suffix.length;
  });
}
