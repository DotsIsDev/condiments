# Publishing to npm

The unscoped package name is `condiments-token-efficiency`. Unscoped npm packages are public. `publishConfig.access` also records public intent.

## First publication

1. Create an npm account and enable two-factor authentication for publishing.
2. Authenticate locally:

   ```sh
   npm login
   npm whoami
   ```

3. Confirm the name is still free:

   ```sh
   npm view condiments-token-efficiency version
   ```

   A registry `E404` means no public package currently occupies the name.

4. Validate tests and the exact publish archive:

   ```sh
   npm run release:check
   ```

5. Publish:

   ```sh
   npm publish --access public
   ```

6. Test from a clean directory:

   ```sh
   npx --yes condiments-token-efficiency@latest --host codex-cli --target .
   ```

## Later releases

Each published name/version pair is permanent. Update the version before publishing again:

```sh
npm version patch
npm run release:check
npm publish --access public
```

Use `minor` for backward-compatible features and `major` for breaking changes.
