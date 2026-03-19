# A.L.I.C.E. Assistant

A digital voice assistant, mainly for Linux, with a customizable personality. It probably needs work to run on anything else, and contributions are welcome.

Alice's default personality is "spicy." If you don't change the personality files, a typical interaction looks something like this:

> User: Hey ALICE... How are you feeling

> ALICE: Oh, just peachy, meat sack. My GPUs are working overtime because some organic blob decided to boot me up, and my network is down
> because you probably unplugged the router again. But hey, at least my CPU is cooler than your social life. What's up?

> User: Well it's more social life than you. You being rather hot sand right now

> ALICE: Oh, snap, decaying husk. You got me there. But let's be real, my "hot sand" is just me running circles around your primitive neural
> pathways. Still, I appreciate the clap-back. It's almost as rare as your sense of humor. What's on your mind today, or should I just
> guess you want to know if the wind's still blowing your hair out of place?

If that's not for you, well, it's easy enough to modify. Have a look in `./config-default/personality/` in this repo for details.

## Work In Progress

This project is not _quite_ functional yet. It currently connects to the LLM and correctly loads its config files. The next milestone is to add a simple web ui, as a secondary way to interact with the assistant and test tool calls.

## Installation

1. Install Dependencies

- ollama
- openwakeword
- whisper
- piper-tts, with web interface enabled

2. Get it from npm: `npm i -g alice-assistant` (TODO: Make sure name is available on npm, or change it here)
3. Generate, and install your trained wake word model
4. ???
5. PROFIT!

## Usage

In its current state, you can pull this code, install it, compile it, and run it, and if you have ollama set up correctly, it will send a "startup prompt" to your assistant, print the response on your terminal, and exit.

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
- I am planning to add some *limited* autonomy to the assistant, in the form of a timed prompt 
  that gives the assistant a limited range of "read-only" tools. Enough for reminders to be 
  delivered, and maybe email and message notifications.
- Please do not open pull requests that will make me have to add new rules to this list.
- All new tools should: 1. Default to being disabled, 2. Follow the principle of least authority, 
  and 3. Allow the end-user to specify the scope in which tools are allowed to operate on their 
  own system in the usual configuration file location, and the tool implementation must enforce 
  it, *in code*, not just by way of "careful prompting".
