import os from "os";
import fs from "fs";
import path from "path";
import childProcess from "child_process";
import { Tool } from "../lib/tool-system";
import { UserConfig } from "../lib/user-config";

type AvailableApplicationDescription = {
  alias: string;
  relevantTopics: string[];
  arguments: string; // annoyingly, this will need to be parsed.
};

type AvailableApplication = {
  alias: string;
  relevantTopics: string[];
  commandLine: string;
  arguments: string;
}

const openApplicationTool: Tool = {
  name: "openApplication",
  description: "Allows the assistant to open applications, files, folders and web pages on behalf of the user. This " +
    "tool tries to be safe by only allowing specific list of user-defined applications to be opened with a limited set of " +
    "parameters. The LLM does not know the specific programs being used to fulfill the user's requests, only aliases.",
  systemPromptFragment: `Call openApplication when the user asks you to open an application, a file, or a folder, ` +
    `or when they ask you to show them something on the web. Call openApplication with no parameters to get a list ` +
    `of available applications and their relevant topics. You may then make a second call to openApplication with the ` +
    `"application" parameter, and any relevant parameters for that application, to open the desired content. For ` +
    `example, if the user says "Can you show me the latest news on the web?", you might first call openApplication ` +
    `with no parameters to get the list of available applications, and see that there is a "web_browser" application ` +
    `with relevant topics including "browse the web" and "show me the page". You would then call openApplication again ` +
    `with the "application" parameter set to "web_browser", and a "url" parameter set to the appropriate news website. `,
  callSignature: "openApplication",
  toolResultPromptIntro: '',
  toolResultPromptOutro: '',
  execute: async (args: Record<string, string>) => {
    // Here you would add the code to execute the appropriate command to open the application or file based on the arguments.
    // For the sake of this example, let's just return a string indicating what would have been opened.
    if (!args.application) {
      // Return the list of available applications and their relevant topics. Lucky for us, this is already defined 
      // in the config, so we can just return that.
      // For safety, we'll filter out the command line from what the LLM sees though.
      const availableApplications = UserConfig.getConfig().tools.openApplication.availableApplications.map((app: AvailableApplicationDescription) => ({
        alias: app.alias,
        relevantTopics: app.relevantTopics,
        arguments: app.arguments
      }));
      return JSON.stringify({ availableApplications });
    }
    const application = args.application;
    const parameters = { ...args };
    delete parameters.application;
    // TODO: we do actually need to run the thing, eventually and not just gaslight the LLM with fake results.
    // What's the best way to do that from node though?
    
    return `Opened ${application} with parameters ${JSON.stringify(parameters)}`;
  }
};

export default openApplicationTool;
