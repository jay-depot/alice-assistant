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

In its current state, you can pull this code, install it, compile it, and run it, and if 
you have ollama set up correctly, it will send a "startup prompt" to your assistant, print 
the response on your terminal, and then start a basic Web UI to chat with the assistant. It 
can do web searches, if you enable the correct plugins, and get a Brave Search API key, and 
it can also use that as a news source, as well as connect to Currents as an alternative. It 
can also connect to Moltbook, if you're crazy enough to try it (unless you really know what 
you're doing,please don't). Past conversation memory also works now, as does internal 
"scratch file" management for the assistant to maintain its own notes as a sort of "extended 
memory".

There is now also a very basic skill recall system.

In the meantime, I've been working on the voice loop in another branch. It's slow work. Audio 
in Node *sucks.* Any tips or contributions there would be *greatly* appreciated.

Future plans for how to interact with this assistant may go one of a few ways:

1. A user-scoped systemd service that runs in the background listening for wake words, and
   accepting web-based chat sessions if the user opens one in their browser
2. Convert this entire thing into an electron app, handle audio monitoring, wake word detection,
   STT processing, TTS processing, and audio output through electron.
3. Modularize even further. Move all audio processing and wake word detection into an external 
   python program that communicates with the main assistant over a socket with a well defined API.

## Installation

1. Install Dependencies

- ollama (See MODELS.md for details on which models work well with Alice Assistant, and which don't)
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

For now, clone this repo, `npm install`, `npm run build`, and then `npm start` to start the 
assistant. The first time you start it, it will create your config directory in 
`~/.alice-assistant/` and populate it with the default config files and then probably error 
out because of missing settings. Follow the instructions in the error messages, which will 
tell you what settings you need to configure. I've tried to make the error messages as 
helpful as possible, but if you run into any that arent, feel free to open an issue and 
I'll try to clarify them.

It will do a quick LLM connection test, and print the model's response to the terminal, 
then it will open a web UI as http://localhost:47153/ where you can chat with the assistant. 
If you have the news-broker and one of the news source plugins enabled, you can try it out by 
asking something like: "What's the latest news on [some topic]?" Tool calls are all logged 
to the terminal for now, so you can confirm they work by checking there.

## Contributing

- I will usually accept pull requests implementing any TODO comments in the code, provided the
  implementation is clean
- If you use an AI to generate it, you still have to be able to explain it in your own, human
  written, words
- Before the conversion to plug-in architecture, I stated that I would not accept pull requests 
  adding agentic features. This is no longer the case, however like alternative LLM providers, 
  they must be fully disabled by default and the relevant plugin's descriptions must clearly 
  state the fact that autonomous features are included.
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
