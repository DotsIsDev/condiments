# Publishing to npm

The scoped package name is `@dotsisdev/condiments`. The `dotsisdev` npm user or organization must own that scope. Scoped packages default to private, so `publishConfig.access` records the required public intent.

## First publication

1. Create an npm account and enable two-factor authentication for publishing.
2. Authenticate locally:

   ```sh
   npm login
   npm whoami
   ```

3. Confirm the name is still free:

   ```sh
   npm view @dotsisdev/condiments version
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
   npx --yes @dotsisdev/condiments@latest --host codex-cli --target .
   ```

## Later releases

Each published name/version pair is permanent. Update the version before publishing again:

```sh
npm version patch
npm run release:check
npm publish --access public
```

Use `minor` for backward-compatible features and `major` for breaking changes.
