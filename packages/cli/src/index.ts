#!/usr/bin/env node
import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerQueryCommand } from './commands/query.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerViewCommand } from './commands/view.js';
import { registerListCommand } from './commands/list.js';
import { registerAddCommand } from './commands/add.js';
import { registerConnectCommand } from './commands/connect.js';
import { registerCheckCommand } from './commands/check.js';
import { registerSliceCommand } from './commands/slice.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerMigrateCommand } from './commands/migrate.js';

const program = new Command();

program
  .name('eventgraph')
  .description('Agent-first architecture modeling tool')
  .version('0.1.0');

registerInitCommand(program);
registerQueryCommand(program);
registerImpactCommand(program);
registerValidateCommand(program);
registerViewCommand(program);
registerListCommand(program);
registerAddCommand(program);
registerConnectCommand(program);
registerCheckCommand(program);
registerSliceCommand(program);
registerVerifyCommand(program);
registerApplyCommand(program);
registerMigrateCommand(program);

program.parse();
