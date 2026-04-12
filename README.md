# A.L.I.C.E. Assistant

A digital voice assistant, mainly for Linux, with a customizable personality. It probably
needs work to run on anything else, and contributions are welcome.

Alice's default personality is "spicy." If you don't change the personality files, a
typical interaction looks something like this:

> User: Hey ALICE... How are you feeling

> ALICE: Oh, just peachy, meat sack. My GPUs are working overtime because some organic
> blob decided to boot me up, and my network is down because you probably unplugged the
> router again. But hey, at least my CPU is cooler than your social life. What's up?

> User: Well it's more social life than you. You being rather hot sand right now

> ALICE: Oh, snap, decaying husk. You got me there. But let's be real, my
> "hot sand" is just me running circles around your primitive neural pathways.
> Still, I appreciate the clap-back. It's almost as rare as your sense of humor.
> What's on your mind today, or should I just guess you want to know if the wind's
> still blowing your hair out of place?

If that's not for you, well, it's easy enough to modify. Have a look in
`./config-default/personality/` in this repo for details. There are also a few examples
in `./config-default/example-personalities/`

## Work In Progress

In its current state, you can pull this code, install it, build it, and run it. If Ollama is
set up correctly, the assistant will run a startup conversation to verify the model connection,
print the response to the terminal, and then start the web UI for chat.

The current runtime already includes plugin-based web search, news brokering, memory, scratch
files, reminders, notifications, daily goals, mood UI extensions, and a growing task-assistant
surface. Voice support also now exists in-tree as a managed local client plus token-protected
local endpoints, but that stack is still evolving.

Optional integrations such as Brave Search, Currents, Moltbook, Piper TTS, Whisper, and wake-word
tooling depend on which plugins you enable and how you configure them.

The remaining roadmap, in no particular order, includes:

- More plugins, especially task assistants. Something for email, and maybe coding.
- The implementation of the plan for progressive levels of agentic features.
- Polishing the out-of-the-box experience that is now starting to exist.
- A TUI might be in the near future.
- Refactoring LLM connections into the plugin layer, so other services can be integrated
- Add hooks to the LLM selection logic, so llm-router plugins could be developed
- Tighten up the voice experience as I use it more and identify rough edges
- Add more tests, especially for the core runtime and plugin system, as well as the plugins themselves.

## Installation

1. Install Ollama.
   See `MODELS.md` for notes on which models work well with Alice Assistant.
2. Clone this repository.
3. Run `npm install`.
4. Run `npm run build`.

Optional local services and tools:

- Piper TTS, if you want local text-to-speech.
- Whisper, if you want local speech-to-text.
- OpenWakeWord and a trained wake-word model, if you want wake-word-driven voice flows.
- External service credentials such as Brave Search or Currents, if you enable the related plugins.

## Usage

Run `npm start` after building.

On first run, the assistant creates `~/.alice-assistant/` and scaffolds it from `config-default/`.
That includes the main config, plugin enablement config, personality files, plugin settings, and
web-interface customization files.

By default, the assistant will:

- load the default config from `~/.alice-assistant/`
- attempt a startup conversation against your configured Ollama model
- print that startup exchange to the terminal
- start the web UI on `http://localhost:47153/` unless you changed the bind address or port

Depending on which plugins you enable and configure, the assistant can also search the web, fetch
news, manage reminders, store long-term memory, use scratch files, and expose plugin-provided UI
regions in the web client. Tool calls are still logged to the terminal.

## Testing

Vitest is configured for the project.

- `npm test` runs the test suite once.
- `npm run test:watch` runs tests in watch mode.
- `npm run test:coverage` runs the suite with coverage reporting.

## Contributing

- I will usually accept pull requests implementing any TODO comments in the code, provided the
  implementation is clean
- If you use an AI to generate it, you still have to be able to explain it in your own, human
  written, words
- Pull requests adding agentic features may be acceptable, but like alternative LLM providers,
  they must be fully disabled by default and the relevant plugin descriptions must clearly state
  that autonomous features are included.
- "I'd like to add the ability to connect to GPT/Claude/Gemini/DeepSeek!" On the unlikely chance
  this project ever gets enough attention for someone to say this, I'll respond in advance: Yes,
  I will accept pull requests extending this project with that functionality, however there are
  two caveats: 1. It must be disabled by default, and 2. The assistant must remain
  "local-model-first," so any cloud model usage needs to be implemented as a fallback for when
  ollama fails, a feature enabled by explicit user request for a specific interaction/conversation,
  or a more permanent "fallback" option for those who want to use this on a machine that can't
  handle local models and understand the trade-off.
- Beyond the above, the only other rule is this: Please do not open pull requests that will make
  me have to add new rules to this list.
