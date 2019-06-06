#!/usr/bin/env node
const readline = require('readline');
const colors = require('colors/safe');
const child_process = require('child_process');
const Path = require('path');

const levelColors = {
    info: 'bold',
    warn: 'yellow',
    error: 'red',
};

const freshr = child_process.spawn(
    'node',
    [Path.join(__dirname, '..', 'build', 'index.js'), '--', ...process.argv.slice(1)]);


process.stdin.pipe(freshr.stdin);
freshr.stderr.pipe(process.stderr);

const freshrLogs = readline.createInterface({
    input: freshr.stdout,
    output: process.stdout,
    terminal: false
});

/** Interactive log filtering
 * typing automatically starts the filtering. ex:
 *     format: property-selector:value-selector
 *
 *     property (level): shows all logs containing "property" at any nesting
 *     'property ('level): shows all logs containing "property" at top level
 *     property:value (level:info): shows all logs where "property" at any nesting has value that fuzzy matches "value"
 *     property:'value (level:'info): shows all logs where "property" at any testing has value that substring matches "value"
 *     'property:value ('level:info): shows all logs where "property" at top level has value that fuzzy-matches "value"
 *     property.child (error.stack): shows all logs containing "property" at any nesting with "child" property
 *     'property.child ('error.stack): shows all logs containing "property" at top level with "child" property
 */

/** array of { log: object, index: */
const logs = [];

/** maps all properties to a flattened index, chronologically ordered */
// const logIndex = {};
// const indexProperties

freshrLogs.on('line', function(line) {
    try {
        const log = JSON.parse(line);
		const originalLog = Object.assign({}, log); // this copy is safe as long as we only modify the top level for printing purposes

        // we don't care about some fields when pretty printing
        delete log.pid;
        var output = '';
        if(log.message) {
            output += log.message;
        }
        if(log.level) {
            output = '[' + log.level + '] ' + output;
            var color = levelColors[log.level];
            if(color) {
                // color the level name and message
                output = colors[color](output);
            }
        }
        // prefix with dim timestamp
        if(log.timestamp) {
            output = colors.dim(('[' + log.timestamp + ']')) + output;
        }

        // add the other fields as formatted json
        delete log.level;
        delete log.message;
        delete log.timestamp;
        if(Object.keys(log).length > 0) {
            output += '\n' + colors.dim(JSON.stringify(log, null, 4));
        }
        console.log(output);

		logs.push({
			log: originalLog,
			output,
		});
    }
    catch(err) {
        console.error(line);
    }
});
