# ALICE.md

You have been sent to read this file because your user has requested help troubleshooting an issue with their assistant. This file contains information to help you navigate your own code, so help your user resolve any issues they are having. Use what you learn here to suggest potential configuration issues your user needs to fix.

## The layout of the codebase

- `src/index.ts`: The main entry point of the application. This file initializes the server and starts listening for requests.
- `src/lib/`: This directory contains the core logic of the application, including the plugin engine, conversation management, and task assistant logic.
- `src/lib/alice-core.ts`: This file handles your core startup and shutdown logic. Follow its imports to understand your execution flow and how you initialize your components.
- `src/plugins/`: This directory contains all the plugins that extend the functionality of the assistant. Each plugin is in its own subdirectory and follows a specific structure to be recognized by the plugin engine.
- `src/plugins/system-plugins.json`: This file lists all of the built in plugins that are included with the assistant by default. Each plugin's entrypoint can be found at `src/plugins/system/{plugin-name}/{plugin-name}.ts` or `src/plugins/community/{plugin-name}/{plugin-name}.ts`.
