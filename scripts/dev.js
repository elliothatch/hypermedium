#!/usr/bin/env node
const readline = require('readline');
const colors = require('colors/safe');
const child_process = require('child_process');
const Path = require('path');

const fuzzysort = require('fuzzysort');
const termkit = require('terminal-kit');

const levelColors = {
    info: 'bold',
    warn: 'yellow',
    error: 'red',
};

const freshr = child_process.spawn(
    'node',
    [Path.join(__dirname, '..', 'build', 'index.js'), '--', ...process.argv.slice(1)]);


process.stdin.pipe(freshr.stdin);
// freshr.stderr.pipe(process.stderr);

const freshrLogs = readline.createInterface({
    input: freshr.stdout,
    output: process.stdout,
    terminal: false
});

const term = termkit.terminal;
term.fullscreen(true);
term.grabInput();

const screenBuffer = new termkit.ScreenBuffer({
	dst: term,
	x: 1,
	y: 1,
});

const resultsBuffer = new termkit.TextBuffer({
	dst: screenBuffer,
	x: 5,
	y: 0,
	width: screenBuffer.width - 5,
	height: screenBuffer.height - 2,
});

const gutterBuffer = new termkit.TextBuffer({
	dst: screenBuffer,
	x: 0,
	y: 0,
	width: 5,
	height: screenBuffer.height - 2,
});

const statusBuffer = new termkit.TextBuffer({
	dst: screenBuffer,
	x: 2,
	y: screenBuffer.height - 2,
	width: screenBuffer.width - 2,
	height: 1,
});

const queryTextBuffer = new termkit.TextBuffer({
	dst: screenBuffer,
	x: 2,
	y: screenBuffer.height - 1,
	width: screenBuffer.width - 2,
	height: 1
});

function draw() {
	queryTextBuffer.draw();
	queryTextBuffer.drawCursor();
	screenBuffer.draw();
	screenBuffer.drawCursor();
}

screenBuffer.put({
	x: 0,
	y: screenBuffer.height - 1,
	// attr: {},
}, '>');
queryTextBuffer.moveTo(0, 0);
draw();

const displayOptions = {
	json: false,
};

let query = '';
term.on('key', (name, matches, data) => {
	if(name === 'CTRL_C') {
		freshr.kill();
	}

	// if(name === 'UP') {
	// }
	// else if(name === 'DOWN') {
	// }
	if(name === 'LEFT') {
		queryTextBuffer.moveBackward();
		draw();
	}
	else if(name === 'RIGHT') {
		// term.getCursorLocation().then(({x, y}) => {
			if(queryTextBuffer.cx <= queryTextBuffer.getContentSize().width) {
				queryTextBuffer.moveForward();
				draw();
			}
		// });
	}
	else if(name === 'TAB') {
		displayOptions.json = !displayOptions.json;
		filterLogs(queryTextBuffer.getText());
	}
	else if(name === 'BACKSPACE') {
		queryTextBuffer.backDelete(1);
		filterLogs(queryTextBuffer.getText());
		draw();
	}
	else if(name === 'DELETE') {
		queryTextBuffer.delete(1);
		filterLogs(queryTextBuffer.getText());
		draw();
	}
	else if(data.isCharacter) {
		queryTextBuffer.insert(name);
		filterLogs(queryTextBuffer.getText());
		draw();
	}

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
 *     property.child (error.stack): shows all logs containing "property" at any nesting with "child" property, edge
 *     'property.child ('error.stack): shows all logs containing "property" at top level with "child" property
 */

/** array of { log: object, index: */
const logs = [];

/** maps all properties to a flattened index. values are arrays of indexes into the logs array */
const logIndex = {};


const indexProperties = [];

/** array of objects for each unique value in the logs, along with property and origin info
 *  - value (string): value string we are searching
 *  - property (string): id of properties this value appears in
 */
const logValues = [];

freshrLogs.on('exit', (code, signal) => {
	term.fullscreen(false);
	console.error(`Process exited: ${code} ${signal}`);
	process.exit();
});

freshrLogs.on('error', (err) => {
	term.fullscreen(false);
	console.error('Process error:', err);
	process.exit();
});

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
                output = term[color]().str(output);
            }
        }
        // prefix with dim timestamp
        if(log.timestamp) {
            output = term.dim().str(('[' + log.timestamp + ']')) + output;
        }

        // add the other fields as formatted json
        delete log.level;
        delete log.message;
        delete log.timestamp;
        if(Object.keys(log).length > 0) {
            output += '\n' + term.dim().str(JSON.stringify(log, null, 4));
        }
        // console.log(output);

		const logOffset = logs.length;
		logs.push({
			log: originalLog,
			output,
		});

		indexLog(log, logOffset);
		filterLogs(queryTextBuffer.getText());
		// const findPropertyResults = fuzzysort.go('level', indexProperties, {
		// 	limit: 100,
		// 	threshold: -10000
		// });

		// const findValueResults = fuzzysort.go('commonjs', logValues, {
		// 	key: 'value',
		// 	limit: 100,
		// 	threshold: -10000,
		// });
		// console.log(findPropertyResults.length, findValueResults.length);
		// findPropertyResults.forEach((result) => {
		// 	logIndex[result.target].forEach((logOffset) => {
		// 		console.log(logs[logOffset].output);
		// 	});
		// });
		// findValueResults.forEach((result) => {
			// logIndex[result.obj.property].forEach((logOffset) => {
				// console.log(logs[logOffset].output);
			// });
		// });

    }
    catch(err) {
        console.error(line);
        throw err;
    }
});

function indexLog(log, logOffset, propertyPrefixes) {
	if(!propertyPrefixes) {
		propertyPrefixes = [];
	}

	if (typeof log !== 'object' || !log) {
		// index property
		const propertyId = propertyPrefixes.join('.');
		if(!logIndex[propertyId]) {
			indexProperties.push(propertyId);
			logIndex[propertyId] = [];
		}
		logIndex[propertyId].push(logOffset);

		// index value
		if(Array.isArray(log)) {
			log.forEach((v) => {
				const value =
					v === null? 'null':
					v === undefined? 'undefined':
					v.toString();

				logValues.push({
					value,
					property: propertyId
				});
			});
			return;
		}

		const value =
			log === null? 'null':
			log === undefined? 'undefined':
			log.toString();
			
		logValues.push({
			value,
			property: propertyId
		});
		return;
	}

	Object.keys(log).forEach((p) => indexLog(log[p], logOffset, propertyPrefixes.concat([p])));
}

function filterLogs(query) {
	const queryParts = query.split(':');

	let findPropertyResults;
	if(queryParts[0].length > 0) {
		findPropertyResults = fuzzysort.go(queryParts[0], indexProperties, {
			limit: 100,
			threshold: -100
		});
	}

	let findValueResults;
	if(queryParts.length > 1) {

		findValueResults = fuzzysort.go(queryParts[1], logValues, {
			key: 'value',
			limit: 100,
			threshold: -100,
		});

		if(findPropertyResults) {
			const propertySet = new Set(findPropertyResults.map((result) => result.target));
			findValueResults = findValueResults.filter((result) => propertySet.has(result.obj.property));
		}
	}

	const logOffsets = new Set();
	if(findPropertyResults) {
		findPropertyResults.forEach((result) => {
			logIndex[result.target].forEach((logOffset) => {
				logOffsets.add(logOffset);
			});
		});
	}
	if(findValueResults) {
		findValueResults.forEach((result) => {
			logIndex[result.obj.property].forEach((logOffset) => {
				logOffsets.add(logOffset);
			});
		});
	}

	const matchedLogs = query.length !== 0?
		Array.from(logOffsets.values()).sort().map((logOffset) => ({log: logs[logOffset].log, offset: logOffset})):
		logs.slice(-200).map((log, i) => ({log: log.log, offset: Math.max(0, logs.length - 200) + i}));

	if(query.length === 0) {
		statusBuffer.setText(`${logs.length}/${logs.length}`);
	}
	else {
		statusBuffer.setText(`${matchedLogs.length}/${logs.length}`);
	}
	resultsBuffer.setText('');
	resultsBuffer.moveTo(0, 0);
	gutterBuffer.setText('');
	gutterBuffer.moveTo(0, 0);

	matchedLogs.forEach(({log, offset}) => {
		let color = levelColors[log.level];
		resultsBuffer.insert(offset.toString(), {color, dim: true});
		gutterBuffer.insert(offset.toString());

		// prefix with dim timestamp
		if(log.timestamp) {
			resultsBuffer.insert(`[${log.timestamp}]`, {color, dim: true});
		}

		if(log.level) {
			resultsBuffer.insert(`[${log.level}] `, {color, dim: true});
		}

		if(log.message) {
			resultsBuffer.insert(log.message, {color});
		}

		const logJson = Object.assign({}, log); // this copy is safe as long as we only modify the top level for printing purposes

		// don't include some fields in json printout
		delete logJson.level;
		delete logJson.message;
		delete logJson.pid;
		delete logJson.timestamp;

		if(displayOptions.json && Object.keys(logJson).length > 0) {
			resultsBuffer.newLine();
			gutterBuffer.newLine();
			const logJsonStr = JSON.stringify(logJson, null, 4);
			resultsBuffer.insert(logJsonStr, {dim: true});

			const jsonLineCount = logJsonStr.split('\n').length;
			for(let i = 0; i < jsonLineCount - 1; i++) {
				gutterBuffer.newLine();
			}
		}
		resultsBuffer.newLine();
		gutterBuffer.newLine();
	});

	const resultsLineOffset = logs.length;

	// resultsBuffer.setText(matchedLogs.join('\n'));
	resultsBuffer.draw();
	// resultsBuffer.draw({
	// 	dstClipRect: new termkit.Rect({
	// 		xmin: 0,
	// 		xmax: resultsBuffer.width,
	// 		ymin: 0 + 21,
	// 		ymax: resultsBuffer.height + 21
	// 	})
	// });
	statusBuffer.draw();
	gutterBuffer.draw();
	screenBuffer.draw();

	queryTextBuffer.drawCursor();
	screenBuffer.drawCursor();
}
