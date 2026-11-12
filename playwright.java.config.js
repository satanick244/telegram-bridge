import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({...base,webServer:{command:'node scripts/java-test-server.mjs',env:{PORT:'3001'},url:'http://127.0.0.1:3001/api/health',timeout:120000,reuseExistingServer:false}});
