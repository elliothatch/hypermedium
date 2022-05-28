import * as fs from 'fs-extra';
import { Build, HalUtil } from 'hypermedium';

export const taskDefinitions: Build.TaskDefinition[] = [{
    name: 'clean',
    description: 'Delete a file or directory',
    func: (inputs, outputs, options, logger) => {
        logger.info("Removing '" + inputs.target[0] + "'");
        return fs.remove(inputs.target[0]);
    },
    inputs: {
        target:  {
            count: [1],
        }
    },
    outputs: {}
}, {
    name: 'copy',
    description: 'Copy a file or directory',
    func: (inputs, outputs, options, logger) => {
        logger.info("Copying '" + inputs.target[0] + "' to '" + outputs.destination[0] + "'");
        return fs.copy(inputs.target[0], outputs.destination[0]);
    },
    inputs: {
        target: {
            count: 1,
        }
    },
    outputs: {
        destination: {
            count: 1,
            hint: '{0}'
        }
    }
}];
