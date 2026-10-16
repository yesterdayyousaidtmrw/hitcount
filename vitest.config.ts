import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['test/setup.ts'],
    // Agent worktrees live under .claude/; their in-progress tests are not this tree's.
    exclude: [...configDefaults.exclude, '.claude/**'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
