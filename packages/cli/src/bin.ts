import { main } from './main';
import { processIo } from './io';

process.exitCode = await main(process.argv.slice(2), processIo());
