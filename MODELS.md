# Ollama Models known to work, or not work, with Alice Assistant.

If you've tested a model not on this list, feel free to open a pull request with an update containing your findings!

If a model doesn't support tool calling, it is not expected to work, and should not be listed here. If a model says it doesn't support tool calling, but it actually worked when you tried it, DO list that here. That's interesting.

## Local models that work well with Alice Assistant
- `Mistral-Small` A "smaller" version of Mistral, which handles the default personality well, though most consumer GPUs can't run it with a context window bigger than 4k, so it's only viable for simple queries unless you've got something like a DGX Spark, Mac Mini (and time to make this thing run on Mac OS), or 128gb Ryzen AI board to play with.
- `Ministral` A *much* smaller version of Mistral, which handles the kinds of prompts Alice Assistant uses *very* well for something that can fit comfortably in a 16gb RX9070xt with a context window around 128k. It's the one I run on my desktop for now, and I'll update this if I run into any issues or major wins with it.
- `Qwen3` At whatever quantization your GPU can handle with the context window kicked up to at least 32k or higher. Lower quantization models spit out broken tool calls more often, but usually they work on the second try. Considering the lower resource usage, and fairly snappy response times, it's a solid choice for local deployment.
- `Qwen3.5` Handles the default personality about as well as Mistral, though it "feels" a little kinder and less intense, IMO. Response quality tends to be good, though the way I handle tool calls and their results confuses it on rare occasions, and the thinking time can be annoyingly long, especially for voice interactions.

## Local models that work, but only for narrow applications or with some issues
- `Granite` It technically works, and handles simple queries well, and even presents the default personality in a recognizable way. Given the low parameter count, I haven't even bothered trying to give it complex tasks though. Still, if you've got some kind of complexity analyzing router that can send the harder stuff elsewhere, it has *strong* potential for handling simple interactions like greetings, small talk, delivering reminders, and answering simple queries like the weather, very cheaply. And, granite is one of the few models you can reasonably run on a CPU (I've tried it), and still get tool calling capability. And it is *fast*. On everything.

## Local models that don't work well, or at all, with Alice Assistant
None so far.

## Cloud models that work well with Alice Assistant
- `GLM-5` My favorite cloud model for this assistant. This one handles the default personality very well. It also handles complex instructions well, and while I haven't gotten the broken tool calls Mistral occasionally spits out, I'm giving it time. Most models produce them eventually. Specifically, GLM-5 handles "personality-patch" skills, like the one I use in the Moltbook plugin, better than Mistral. It also handled the instructions to create and read specific scratch files from that skill perfectly. If you were planning to use Ollama Cloud anyway, choose this model. I anticipate this one would also be a solid performer for agent tasks, if we introduce those in the future.
- `Mistral Large 670b` This one handles the default personality *flawlessly*, if maybe making it a little *too* intense. It pukes out broken tool calls on rare occasions, but in a way the internal retry logic handles fine, and otherwise is very solid. It's not billed as an agent-focused model by its creators, but it seems to handle instructions in chat well, though it gets a little lost in complex tasks, so it's probably only an "okay" choice for agent tasks, if we introduce those in the future.
- `Qwen 3.5` The cloud version of Qwen 3.5 performs similarly to the local version in terms of response "quality" and personality adherence. It also manages significantly better accuracy in its responses by virtue of being just that darned big, though it still gets tool calls wrong on occasion, and the thinking time is about the same as the local version, which is frankly way too long for voice interactions, but still somewhat manageable for text-based interaction. It should also be a solid choice for agent tasks, in a hypothetical future where we introduce those.

## Cloud models that work, but only for narrow applications or with some issues
- `Minimax m2.5` It *usually* works, but sometimes flat-out refuses to play along with the default personality, and it can't tell when it's successfully called a tool, which causes it to go into degenerate call loops. It also often attributes tool result messages *to the user* which results in some weird responses. Unfortunate, because when it does work, the output is *spectacularly* good. All that said, if the tool-call detection and result attribution issues are fixed (which I believe is a problem on my end, not theirs), it would be a good alternative model for agent tasks that are better off *without* much personality influence. If your preferred assistant personality is less "spicy, sarcastic ASI," this model might actually serve you well once those issues are resolved.

## Cloud models that don't work well, or at all, with Alice Assistant
- `Minimax m2.7` Crashes. Seriously. It can't even do the smoke-test prompt at startup. Sad, because it runs OpenCode flawlessly, and would be a great choice for general agent tasks and code-related queries if it didn't have this issue. I have tested it by sending the personality and query prompts in the Ollama chat ui directly, and I can say with some confidence that if it didn't crash, it would be a top choice among the cloud options.

## Models I intend to test soon:
- `Gemma 4` I'm rather excited to try this one. I've already "faked it" by sending the personality and query prompts to Gemini, and aside from being *way* more verbose than I'd like, it handled everything else rather well. Since Gemma 4 is rather close to what the latest Gemini can do, I'm expecting good things here.
- `GPT-OSS` I don't know why I haven't tried this one yet. It should be pretty solid though. Will confirm soon.

## Commercial models I'm curious about, but would take serious changes to the assistant to try:
- `Claude` I'm not kidding. It would require significant refactoring to move LLM provider support into plugins, since we can only connect using Anthropic's API, but I'm curious to see how it handles it.
- `GPT` Ditto as Claude.
- `Gemini` Ditto as Claude, though I'm especially curious to see how the latest version handles it, since the earlier versions were pretty good at following the personality and instruction prompts when I tested them in the chat ui.
- `DeepSeek, Kimi, etc` Unless they run into broken tool calls the way Ollama models can, any of these should also give at least "acceptable" performance, if not outright "good" performance.
