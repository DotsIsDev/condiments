export function isExpired(expiresAtSeconds, nowSeconds) {
  return expiresAtSeconds <= nowSeconds;
}

