# Neon Orb

Neon Orb is a real-time voice assistant experience built with Next.js, Deepgram, and Supabase. It captures microphone input, connects to a Deepgram conversational agent over WebSocket, renders live narrative scenes, and persists conversation state in Postgres via Supabase.

## Overview

This project blends:

- a cinematic, neon interface
- real-time speech capture and playback
- conversational AI orchestration via Deepgram
- scene inference and visual rendering from assistant output
- persistent memory for conversations, turns, and scene snapshots

## Overview

This project is build by:

- Isaac Kigen (isaackigen86@gmail.com)

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Supabase SSR + Postgres
- Deepgram Voice Agent / WebSocket API
- Custom audio engine and visual scene system

## Project Structure

- `app/` — Next.js routes, API endpoints, and app shell
- `components/` — UI and visual components
- `hooks/` — session and voice assistant state
- `lib/` — agent config, audio, Supabase, and visual helpers
- `supabase/migrations/` — database schema
- `types/` — shared TypeScript contracts

## Features

- Anonymous or authenticated Supabase session handling
- Deepgram token minting through a server route
- Real-time microphone streaming to the agent
- Assistant audio playback and response handling
- Conversation persistence for user and assistant turns
- Scene generation from conversation content
- Neon orbital visual interface with motion-driven output

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your environment variables in `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   DEEPGRAM_API_KEY=your_deepgram_key
   ```

3. Run the app:

   ```bash
   npm run dev
   ```

4. Open:

   ```text
   http://localhost:3000
   ```

## Production Build

```bash
npm run build
```

## Important Notes

- The Deepgram API key must be kept on the server side.
- The browser never receives the raw secret key.
- The app fetches a short-lived token from `/api/deepgram/token` and then connects to the Deepgram agent over WebSocket.
- The Supabase schema in `supabase/migrations/0001_init.sql` defines the conversation, turn, and scene tables.

## License

This project is for personal and experimental development use unless otherwise specified.
