// App entry point. `--ci` runs the checks headless from the command line (see
// ci.cjs); anything else starts the editor.
if (process.argv.includes('--ci')) require('./ci.cjs');
else require('./main.cjs');
