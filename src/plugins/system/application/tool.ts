import * as childProcess from 'child_process';
import { Static, Type } from 'typebox';
import { Tool } from '../../../lib/tool-system.js';
import { ApplicationPluginConfigSchema } from './application.js';

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
};

const parameters = Type.Optional(
  Type.Object({
    application: Type.String(),
    parameters: Type.Record(Type.String(), Type.String()),
  })
);

export const openApplicationTool: (
  config: ApplicationPluginConfigSchema
) => Tool = config => ({
  name: 'openApplication',
  availableFor: ['chat', 'voice'],
  description:
    'Allows the assistant to open applications, files, folders and web pages on behalf of the user. Call with no parameters to discover the available applications.',
  systemPromptFragment:
    `Call openApplication when the user asks you to open an application, a file, or a folder, ` +
    `or when they ask you to show them something on the web. Call openApplication with no parameters to get a list ` +
    `of available applications and their relevant topics. You may then make a second call to openApplication with the ` +
    `"application" parameter, and any relevant parameters for that application, to open the desired content. For ` +
    `example, if the user says "Can you show me the latest news on the web?", you might first call openApplication ` +
    `with no parameters to get the list of available applications, and see that there is a "web_browser" application ` +
    `with relevant topics including "browse the web" and "show me the page". You would then call openApplication again ` +
    `with the "application" parameter set to "web_browser", and a "url" parameter set to the appropriate news website. `,
  callSignature: 'openApplication',
  parameters,
  toolResultPromptIntro: '',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    if (!args || !args.application) {
      const availableApplications = config.availableApplications.map(
        (app: AvailableApplicationDescription) => ({
          alias: app.alias,
          relevantTopics: app.relevantTopics,
          arguments: app.arguments,
        })
      );
      return JSON.stringify({ availableApplications });
    }

    const application = args.application;
    const appParameters = { ...args };
    delete appParameters.application;

    const appConfig = config.availableApplications.find(
      (app: AvailableApplication) => app.alias === application
    );
    if (!appConfig) {
      return `Error: Application "${application}" not found in available applications.`;
    }

    try {
      let cmdArgs: string[] = [];
      let bin = appConfig.commandLine;
      if (appConfig.commandLine.includes(' ')) {
        const parts = appConfig.commandLine.split(' ');
        bin = parts[0];
        cmdArgs.push(...parts.slice(1));
      }
      if (appConfig.arguments && Object.keys(appParameters).length > 0) {
        const argTemplate = appConfig.arguments;
        let constructedArgs = argTemplate;
        for (const [key, value] of Object.entries(appParameters)) {
          constructedArgs = constructedArgs.replace(
            new RegExp(`{{${key}}}`, 'g'),
            String(value)
          );
        }
        cmdArgs = constructedArgs.split(' ');
      }
      childProcess
        .spawn(bin, cmdArgs, {
          detached: true,
          stdio: 'ignore',
        })
        .unref();
      return `Opened ${application} successfully. Respond to the user now.`;
    } catch (error) {
      return `Error opening ${application}: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
