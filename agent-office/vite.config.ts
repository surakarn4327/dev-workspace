import { defineConfig } from 'vite';
import { helperPlugin } from './helper/vite-plugin.ts';

// The helper (web search / news / page reading) starts with the dev server and `vite preview`.
export default defineConfig({
  plugins: [helperPlugin()],
});
