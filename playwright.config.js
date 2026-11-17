import { defineConfig, devices } from '@playwright/test';

/*
 * Two projects:
 *   local   the app served as plain files: two tabs linked by local-room.js (no accounts)
 *   server  the app served by server/: two separate users, matchmaking, chat, safety
 */
export default defineConfig({
  timeout: 240_000,
  use: { ...devices['Desktop Chrome'] },
  webServer: [
    // A plain static server: live-server would reload the page whenever test-results/ changes.
    { command: 'python3 -m http.server 5174 --bind 127.0.0.1', url: 'http://127.0.0.1:5174', reuseExistingServer: true, timeout: 60_000 },
    { command: 'node server/index.js', url: 'http://localhost:5175/api/health', env: { PORT: '5175', DB_PATH: ':memory:', DOTENV: 'off' }, reuseExistingServer: false, timeout: 60_000 },
  ],
  projects: [
    { name: 'local', testMatch: /two-tab\.spec\.js/, use: { baseURL: 'http://127.0.0.1:5174' } },
    { name: 'server', testMatch: /server-match\.spec\.js/, use: { baseURL: 'http://localhost:5175' } },
  ],
});
