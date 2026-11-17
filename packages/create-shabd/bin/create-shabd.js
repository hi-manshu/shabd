#!/usr/bin/env node
import { main } from '../src/create.js'

process.exitCode = await main(process.argv.slice(2))
