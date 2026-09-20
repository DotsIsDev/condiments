const key = String(process.argv[2] ?? "UNKNOWN").toUpperCase();

for (let index = 1; index <= 800; index += 1) {
  console.log(`INFO ${key} request-${index} completed`);
}
console.error(`ERROR REUSE_TOKEN_${key} recovery-required`);
