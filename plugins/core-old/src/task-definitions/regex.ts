import { from, bindNodeCallback, forkJoin } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import * as fs from 'fs-extra';

import { TaskDefinition } from 'freshr';

/**
 * options:
 *  - rules: object or array of objects describing match-and-replace rules:
 *    - regex: regex to match
 *    - replace: new string that will replace matches
 */
export const RegexTask: TaskDefinition = {
    name: 'regex',
    description: 'Uses regex to process text in a file',
    func: (inputs, outputs, options, logger) => {
        if(!options || !options.rules) {
            logger.error(`No rules provided. Please provide the 'rules' property in the task options`);
        }

        if(!Array.isArray(options.rules)) {
            options.rules = [options.rules];
        }

        return from(fs.readFile(inputs.target[0])).pipe(
            mergeMap((contents) => {
                const newContents = options.rules.reduce(
                    (text: string, rule: Rule) => text.replace(rule.regex, rule.replace),
                    contents.toString('utf8')
                );
                return fs.outputFile(outputs.destination[0], newContents);
            })
        );
    },
    inputs: {
        target: {
            count: [1],
        }
    },
    outputs: {
        destination: {
            count: 1,
            hint: '{}'
        }
    }
};

interface Rule {
    regex: RegExp;
    replace: string;
}
