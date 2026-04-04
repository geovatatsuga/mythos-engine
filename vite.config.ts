import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.GROQ_MODEL': JSON.stringify(env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
        'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL || 'gemini-2.0-flash'),
        'process.env.GEMINI_FALLBACK_MODEL': JSON.stringify(env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash-lite'),
        'process.env.CEREBRAS_MODEL': JSON.stringify(env.CEREBRAS_MODEL || 'qwen-3-235b-a22b-instruct-2507'),
        'process.env.OPENROUTER_MODEL': JSON.stringify(env.OPENROUTER_MODEL || 'qwen/qwen3.6-plus:free'),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
