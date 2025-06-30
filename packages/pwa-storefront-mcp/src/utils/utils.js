/*
 * Copyright (c) 2025, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import fs from 'fs'
import path from 'path'
import pty from 'node-pty'
import {fileURLToPath} from 'url'
import {zodToJsonSchema} from 'zod-to-json-schema'
import {z} from 'zod'

// Emulate __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Private schema used to generate the JSON schema
const emptySchema = z.object({}).strict()

export const EmptyJsonSchema = zodToJsonSchema(emptySchema)

/**
 * Converts a string to kebab-case (e.g., ProductCard -> product-card)
 */
export function toKebabCase(str) {
    return str
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/\s+/g, '-')
        .toLowerCase()
}

/**
 * Converts a string to PascalCase (e.g., product-card -> ProductCard)
 */
export const toPascalCase = (str) =>
    str.replace(/(^\w|[-_\s]\w)/g, (match) => match.replace(/[-_\s]/, '').toUpperCase())

/**
 * Spawns a pseudo-terminal process and captures its output.
 *
 * This is useful for running CLI tools that emit different output
 * when run in a TTY environment (e.g., with color, formatting, or paging).
 *
 * @param {string} command - The command to execute (e.g., 'npx').
 * @param {string[]} [args=[]] - An array of arguments to pass to the command.
 * @returns {Promise<string>} Resolves with the full output from the process if it exits with code 0,
 *                            otherwise rejects with an Error containing the exit code.
 *
 * @example
 * const output = await runWithPty('npx', ['some-cli', '--help'])
 */
export const runWithPty = (command, args = []) => {
    return new Promise((resolve, reject) => {
        const ptyProcess = pty.spawn(command, args, {
            name: 'xterm-color',
            env: process.env
        })

        let output = ''

        ptyProcess.onData((data) => {
            output += data
        })

        ptyProcess.onExit(({exitCode}) => {
            if (exitCode === 0) {
                resolve(output)
            } else {
                reject(new Error(`PTY exited with code ${exitCode}`))
            }
        })
    })
}

/**
 * Checks if the project is a monorepo by verifying the existence of lerna.json in the root directory.
 *
 * @returns {boolean} True if lerna.json exists in the '../../../..' folder, false otherwise.
 */
export function isMonoRepo() {
    const lernaPath = path.resolve(__dirname, '../../../..', 'lerna.json')
    return fs.existsSync(lernaPath)
}
