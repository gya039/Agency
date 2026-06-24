import { defineConfig } from 'vite'

// The Phaser world is a window only — it talks to the Flask backend on :5003.
export default defineConfig({
  server: { port: 5174, strictPort: true },
})
