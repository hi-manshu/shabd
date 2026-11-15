#!/usr/bin/env node
import('../dist/node/cli.js').then(({ main }) => main(process.argv.slice(2)))
