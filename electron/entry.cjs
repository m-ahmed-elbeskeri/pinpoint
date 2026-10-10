if (process.argv.includes('--ci')) require('./ci.cjs');
else require('./main.cjs');
