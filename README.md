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

This project is not _quite_ functional yet, though it's getting there quickly now. It 
currently connects to the LLM and correctly loads its config files, then runs a basic 
Web UI to talk to your assistant that way until you interrupt it with ^C. There is 
also a functional plugin architecture with semantics for dynamically loading and 
type-checking plugin-scoped configuration, type-checked external API offer and request 
semantics between plugins, and dependency checks.

The next milestone is improving the web UI so other plugins may add their own elements 
to it. Following that, will be a proof-of-concept wake-word -> dictation -> assistant 
request loop, and then filling in the missing functionality in all system plugins.

## Installation

1. Install Dependencies

- ollama
- openwakeword
- whisper
- piper-tts

2. ~~Get it from npm: `npm i -g alice-assistant` (TODO: Make sure name is available on
   npm, or change it here)~~ Really, just pull it from this repo for now. I'll publish
   this when it's in a more useful state.
3. Generate, and install your trained wake word model
4. ???
5. PROFIT!

## Usage

In its current state, you can pull this code, install it, compile it, and run it, and if 
you have ollama set up correctly, it will send a "startup prompt" to your assistant, print 
the response on your terminal, and then start a basic Web UI to chat with the assistant.

The next milestone is an actual wake word and voice interaction loop, and 

Future plans for how to interact with this assistant may go one of two ways:

1. A user-scoped systemd service that runs in the background listening for wake words, and
   accepting web-based chat sessions if the user opens one in their browser
2. Convert this entire thing into an electron app, handle audio monitoring, wake word detection,
   STT processing, TTS processing, and audio output through electron.

## Contributing

- I will usually accept pull requests implementing any TODO comments in the code, provided the
  implementation is clean
- If you use an AI to generate it, you still have to be able to explain it in your own, human
  written, words
- I will not accept pull requests adding "heartbeats," "webhooks," or other autonomous agentic
  features. Agentic AI is a little more advanced, and I'd like to keep this project friendly to
  relative newcomers who just want to play with a quirky assistant. That said, feel free to fork
  and add those things to your version of this if you want. I'll accept other fixes unrelated to
  those topics from your fork, regardless.
- I am planning to add some _limited_ autonomy to the assistant, in the form of a timed prompt
  that gives the assistant a limited range of "read-only" tools. Enough for reminders to be
  delivered, and maybe email, message, and user wellbeing notifications. The approach I'm
  planning here is to add a flag to each tool to mark if it is "autonomy safe," which means it is
  read-only, or only writes to the assistant's own scratch area, and those would be the only
  tools presented to the LLM when sending it an "autonomy prompt." The assistant would then
  have to start a conversation with the user to access its full tool suite.
- All new tools should: 1. Default to being disabled, 2. Follow the principle of least authority,
  and 3. Allow the end-user to specify the scope in which tools are allowed to operate on their
  own system in the usual configuration file location, and the tool implementation must enforce
  it, _in code_, not just by way of "careful prompting".
- "I'd like to add the ability to connect to GPT/Claude/Gemini/DeepSeek!" On the unlikely chance
  this project ever gets enough attention for someone to say this, I'll respond in advance: Yes,
  I will accept pull requests extending this project with that functionality, however there are
  two caveats: 1. It must be disabled by default, and 2. The assistant must remain
  "local-model-first," so any cloud model usage needs to be implemented as a fallback for when
  ollama fails, a feature enabled by explicit user request for a specific interaction/conversation,
  or a more permanent "fallback" option for those who want to use this on a machine that can't
  handle Ollama and understand the trade-off.
- Beyond the above, the only other rule is this: Please do not open pull requests that will make
  me have to add new rules to this list.
