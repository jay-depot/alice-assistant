# A.L.I.C.E. Assistant

A digital voice assistant, mainly for Linux, with a customizable personality. It probably works on a Mac, too.

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
