# LearnWithAI (LWAI)

A contextual AI chat interface built for deep learning.

## Why I built this

Standard AI chat interfaces are entirely linear, asking a follow-up question usually derails the entire conversation. I wanted a UI that behaves more intuitive to learning/exploring a topic. LWAI allows you to highlight a specific concept in an AI's response, branch off into a contextual sub-chat to dive deep, and then seamlessly return to your main thread.

## Core Features

- **Contextual Sub-chats:** Highlight any text and click "Ask more" to spawn an isolated, context-aware thread.
- **Notebook:** Save key insights, code snippets, or diagrams to a persistent notebook from any UI state.
- **End-to-End Privacy:** Run open-source models locally out of the box. This architecture protects ensures complete privacy — no telemetry, no cloud logging, and no data sharing.

## Getting Started

### Prerequisites

- Node.js (v18+)
- [Ollama](https://ollama.com/) running locally (if using local models).

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/smadduri9/lwai.git
   cd lwai
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your environment: Copy `.env.example` to `.env` and add your API keys (only required if you are using cloud models).

4. Start the development server:

   ```bash
   npm run dev
   ```

## Tech Stack

React 19, Vite, TypeScript, Tailwind CSS, Zustand (State Management), Dexie (IndexedDB), and CodeMirror (Code Sandbox).

## License

MIT
