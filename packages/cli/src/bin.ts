import { main } from './main';
import { processIo } from './io';

// `archguide check | head`: a closed pipe is not an error.
for (const stream of [process.stdout, process.stderr])
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
  });

process.exitCode = await main(process.argv.slice(2), processIo());
