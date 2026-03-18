# A.L.I.C.E. Assistant

A digital voice assistant, mainly for Linux, with a customizable personality. It probably works on a Mac, too. 

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

This project is not *quite* functional yet, as the first thing I've been doing is setting up the prompt structures and testing them manually in Ollama. This section will be removed from the README when this project is able to be installed and used.


## Installation

1. Install Dependencies
  - ollama
  - openwakeword
  - whisper
  - piper-tts, with web interface enabled

2. Get it from npm: `npm i -g alice-assistant` (TODO: Make sure name is available on npm, or change it here)
3. Generate, and install your trained wake word model
4. Enable in systemd for your user, or add to your DE/Window manager's autostart


## Usage

ALICE is intended to be set up as a user-scoped systemd service, but has no hard dependencies on systemd. If you
are not using systemd, then simply add `alice-start` to wherever your desktop environment handles automatically 
starting programs at login.


## Contributing

- I will usually accept pull requests implementing any TODO comments in the code, provided the implementation is clean
- If you use an AI to generate it, you still have to be able to explain it in your own, human written, words
- I will not accept pull requests adding "heartbeats," "webhooks," or other autonomous agentic features. Agentic 
  AI is a little more advanced, and I'd like to keep this project friendly to relative newcomers who just 
  want to play with a quirky assistant. That said, feel free to fork and add those things to your version of 
  this if you want. I'll accept other fixes unrelated to those topics from your fork, regardless.
- Please do not open pull requests that will make me have to add new rules to this list.
