#!/usr/bin/env node
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');

console.log('REPLOID CLI');

// This is the CLI entry point for PAWS orchestration.
// For now, it just defines a placeholder 'goal' command.

yargs(hideBin(process.argv))
  .command('goal [text]', 'Set the goal for the agent', (yargs) => {
    return yargs
      .positional('text', {
        describe: 'The goal description for the agent to execute',
        type: 'string'
      })
  }, (argv) => {
    console.log('Goal received:', argv.text);
    // In the future, this will communicate the goal to a running agent instance.
    if (!argv.text) {
        console.log('Please provide a goal.')
    }
  })
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .argv;
