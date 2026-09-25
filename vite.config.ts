import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { validatePublicConfig } from './src/lib/supabase-config.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    const error = validatePublicConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
    if (error) throw new Error(error)
  }
  return { plugins: [react()] }
})
