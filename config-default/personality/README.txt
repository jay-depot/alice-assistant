This directory contains your assistant's personality files. Don't worry, it can't read this one.
It only reads the `.md` files in this directory, and when it builds the assistant's system prompt,
it takes the contents of intro.md, and then the contents of quirks.md to build specific sections of
the personality brief. Any other .md files in this directory are added to the prompt after that, 
with the filename transformed into the section heading.

So, for example, if you have a file in here called `user-wellbeing.md` (which you do, by default),
then the contents of that file will be added to the system prompt with a section heading of 
`## USER WELLBEING`. Simple, eh? So, say you wanted to add a section to the personality brief 
about how your assistant should approach giving advice to the user, you could create a file in here
called `giving-advice.md`, and then write your advice-giving guidelines in there, and it would be 
added to the system prompt with a section heading of `## GIVING ADVICE`. You can use this to set up 
sections for interests it can bring up, the nicknames it has for you, or the ones you have for it.

Remember, everything in here is getting fed to a locally running LLM as part of the system prompt, 
so be mindful of the length of these files. The more concise and specific you can be in describing 
your assistant's personality, quirks, and any other relevant information about them, the better. 

You may have noticed a few other files in here without .md extensions. They have names like 
`intro.tips.txt` or `quirks.tips.txt`. These files are not read by the assistant at all, but are 
there to provide you with some tips and guidance on how to use those specific sections of the 
personality brief effectively. You assistant can't read them, but you can, so if you want to 
leave yourself notes for later in them, feel free, it won't break anything.
