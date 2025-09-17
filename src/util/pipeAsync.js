import {pipeline} from 'node:stream'
import {promisify} from 'node:util'

export const pipeAsync = promisify(pipeline)
