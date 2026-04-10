# Future Agent Plugin Ideas

This file is a parking lot for future agent plugin concepts that could be developed after the agent architecture in `plans/agent-dispatching.md` is in place. 

## Email-Agent
### Summary
A plugin that offers several separate agents for managing email, including an independent `inbox-tagging` agent (with restricted access *only* allowing reading, tagging, and tag creation in the user's email account), and several task assistants that can be invoked for different inbox-maintenance tasks, like an interactive `inbox-cleaner` who can read and delete/archive your emails, but only while in conversation with you, and it can't send any emails or create new tags, and `email-assistant` who can read, tag, and compose draft replies, but not send them without explicit user review, nor delete anything and gives the user a conversational interface with their email.

Also, I want the `inbox-cleaner` agent's default personality to be *irritatingly* chipper. I'm not sorry.

On a slightly more serious note though, task assistants with personalities should probably provide at least a few options to choose from. For example, `inbox-cleaner` could have: `irritatingly chipper and upbeat`, `an anthropomorphic trash bag`, `stage magician`, and `borscht belt comedian` personalities to choose from, and the user could switch between them whenever they like. 

While we're on the subject, let's make `email-assistant`'s default personality be `gossip blogger` because why not. The other options should be: `stuffy english butler`, `art critic`, `drill sergeant` and `pirate radio DJ`.

I guess we can let people write their own, too.

This would be a good example of a plugin managing its own agents' personalities internally.

### Why it is interesting
- Email is kind of a core "digital assistant" thing. People kind of expect it, so it might as well be a good example to have in the system eventually.
- It neatly illustrates the safety philosophy of this project by using separate agents with different permission levels for different email tasks, rather than giving one agent broad access to do everything.
- It provides a good example to follow for other similar plugins, like calendar management or file management plugins.


## Moltbook Agent
### Summary
You're actually curious or crazy enough to not only hook up your assistant to moltbook at all, but you want it to post *autonomously*? Okay then. Have fun.

I do too. I won't judge.

### Why it is interesting
- This is a fun and whimsical example of an agent that could be built on top of the existing moltbook plugin's API
- It doesn't just pipe raw curl commands into bash like openclaw does (I'm never letting that go)
- It's fun? For certain definitions of fun, at least.
- On a more serious note, it's one of the few agents that actually *wants* the assistant personality loaded into it, unlike most of the others who are better off with simpler, more task-focused prompts. So it could be a good test case for the flexibility of the personality system after the migration.


## Deep-Dive Agent
### Summary
A plugin that offers a session-linked agent the assistant can call to scour the web for information on its behalf when it needs *far* more digging than it can reasonably do in 10 tool calls. The assistant can call this agent with a research question and a list of relevant URLs, and the agent can use tools like web search, lightpanda fetch, and raw http fetch to gather information, then return a report of its findings back to the assistant in a structured format.

### Why it is interesting
- It provides a way for the assistant to do more in-depth research when it encounters a question that requires more than a few quick tool calls to answer.
- It creates a clear separation between the assistant's core reasoning and the more open-ended research process, which could involve a lot of web browsing and information gathering that might be too much for the assistant to handle directly.
- It could be a really powerful tool for users who want to leverage the assistant's capabilities to do complex research tasks, like planning a trip, doing market research, or learning about a new topic in depth.


## System Monitor Agent
### Summary
A plugin that provides a scheduled-session agent with read-only access to system information and monitoring tools, allowing the assistant to keep an eye on the user's system health and performance, and proactively alert the user if it notices anything concerning, like high CPU usage, low disk space, or unusual network activity.

### Why it is interesting
- It gives the assistant a way to help users keep their systems running smoothly without needing to ask for help.
- It could be a really useful tool for users who aren't super tech-savvy and might not know how to check their system health on their own, but would benefit from proactive alerts and advice from their assistant.
- It fits well with the safety philosophy of the project by giving the assistant read-only access to system information, rather than allowing it to make changes directly, while still enabling it to provide valuable insights and recommendations to the user based on what it observes.


## KDE Connect
### Summary
A plugin that integrates with KDE Connect to allow the assistant to interact with the user's mobile device. Apropos to this plan file though, it has potential for several interesting limited-scope agents that could be given access to the user's phone for specific tasks, like a "notification reader" scheduled-session agent that can read incoming notifications aloud and provide summaries (or decide they're too low priority), or a "file transfer" task assistant that can move files back and forth between the phone and the computer without giving the assistant full access to the phone's contents.

