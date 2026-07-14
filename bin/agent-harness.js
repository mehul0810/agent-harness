#!/usr/bin/env node

import { executeCli, formatCliResult } from '../src/cli.js';

const result = await executeCli(process.argv.slice(2));
const output = formatCliResult(result);
const stream = result.ok ? process.stdout : process.stderr;
stream.write(output);
process.exitCode = result.exitCode;
