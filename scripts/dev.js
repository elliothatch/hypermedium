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
    // [Path.join(__dirname, 'dev.test.js'), '--', ...process.argv.slice(1)]);


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

const resultsPanelBuffer = new termkit.ScreenBuffer({
	dst: screenBuffer,
	height: screenBuffer.height - 2,
});

const queryPanelBuffer = new termkit.ScreenBuffer({
	dst: screenBuffer,
	y: screenBuffer.height - 1,
	height: 1
});

const gutterBufferWidth = 5;

const resultsBuffer = new termkit.TextBuffer({
	dst: resultsPanelBuffer,
	x: 5,
	y: 0,
	width: resultsPanelBuffer.width - gutterBufferWidth,
	// height: screenBuffer.height - 2,
	forceInBound: true,
});

const gutterBuffer = new termkit.TextBuffer({
	dst: resultsPanelBuffer,
	x: 0,
	y: 0,
	width: gutterBufferWidth,
	// height: screenBuffer.height - 2,
});

const statusBuffer = new termkit.TextBuffer({
	dst: screenBuffer,
	x: 2,
	y: screenBuffer.height - 2,
	width: screenBuffer.width - 2,
	height: 1,
});

const queryTextBufferWidth = 10;
const queryTextBuffer = new termkit.TextBuffer({
	dst: queryPanelBuffer,
	x: 2,
	width: queryTextBufferWidth,
});

const parsedQueryTextBuffer = new termkit.TextBuffer({
	dst: queryPanelBuffer,
	x: 2 + queryTextBufferWidth,
	width: queryPanelBuffer.width - (2+queryTextBufferWidth),
});

function draw() {
	queryTextBuffer.draw();
	parsedQueryTextBuffer.draw();
	queryPanelBuffer.draw();
	screenBuffer.draw();

	queryTextBuffer.drawCursor();
	parsedQueryTextBuffer.drawCursor();
	queryPanelBuffer.drawCursor();
	screenBuffer.drawCursor();
}

queryPanelBuffer.put({
	x: 0,
	y: 0,
	// attr: {},
}, '>');
queryTextBuffer.moveTo(0, 0);
draw();

const displayOptions = {
	json: false,
};

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
	else if(name === 'PAGE_UP') {
		resultsBuffer.y = Math.min(resultsBuffer.y + 12, 0);
		gutterBuffer.y = Math.min(gutterBuffer.y+12, 0);
		drawResults();
	}
	else if(name === 'PAGE_DOWN') {
		resultsBuffer.y = Math.max(resultsBuffer.y - 12, -resultsBuffer.cy + screenBuffer.height - 2);
		gutterBuffer.y = Math.max(gutterBuffer.y-12, -gutterBuffer.cy + screenBuffer.height - 2);
		resultsPanelBuffer.fill({char: ' '});
		drawResults();
	}
	else if(name === 'ESCAPE') {
		queryTextBuffer.backDelete(queryTextBuffer.cx);
		filterLogs(queryTextBuffer.getText());
		draw();
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

freshrLogs.on('close', (code, signal) => {
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
		/*
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

		*/
		const logOffset = logs.length;
		logs.push({
			log,
		});

		indexLog(log, logOffset);
		filterSingleLog(queryTextBuffer.getText(), logOffset);
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
					property: propertyId,
					logOffset
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
			property: propertyId,
			logOffset
		});
		return;
	}

	Object.keys(log).forEach((p) => indexLog(log[p], logOffset, propertyPrefixes.concat([p])));
}

function filterSingleLog(query, logOffset) {
	if(query.length > 0 || query === ':') {
		return;
	}
	printLog(logs[logOffset].log, logOffset);
	const resultsLineOffset = logs.length;

	resultsBuffer.y = -resultsBuffer.cy + screenBuffer.height - 2 ;
	gutterBuffer.y = -gutterBuffer.cy + screenBuffer.height - 2 ;

	if(query.length === 0) {
		statusBuffer.setText(`${logs.length}/${logs.length}`);
	}

	// resultsBuffer.setText(matchedLogs.join('\n'));
	drawResults();
}


function filterLogs(query) {

	const logLimit = displayOptions.json? 50: 200;

	const queryParts = query.split(':');
	parsedQueryTextBuffer.backDelete(parsedQueryTextBuffer.cx);
	parsedQueryTextBuffer.insert(`${queryParts[0]}`, {color: 'red'});

	let findPropertyResults;
	if(queryParts[0].length > 0) {
		findPropertyResults = fuzzysort.go(queryParts[0], indexProperties, {
			limit: 100,
			threshold: -100
		});
	}

	let findValueResults;
	if(queryParts.length > 1) {
		parsedQueryTextBuffer.moveRight();
		parsedQueryTextBuffer.insert(`${queryParts[1]}`, {color: 'blue'});
		findValueResults = fuzzysort.go(queryParts[1], logValues, {
			key: 'value',
			limit: 100,
			threshold: -100,
		});

		// if(findPropertyResults) {
		// 	const propertySet = new Set(findPropertyResults.map((result) => result.target));
		// 	findValueResults = findValueResults.filter((result) => propertySet.has(result.obj.property));
		// }
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
			logOffsets.add(result.obj.logOffset);
		});
	}

	// TODO: a property:value query should only show logs that have the value set on the specified property, but we are displaying the union of any logs containing the matching property or value

	const matchedLogs = query.length !== 0 && query !== ':'?
		Array.from(logOffsets.values()).sort().slice(-logLimit).map((logOffset) => ({log: logs[logOffset].log, offset: logOffset})):
		logs.slice(-logLimit).map((log, i) => ({log: log.log, offset: Math.max(0, logs.length - logLimit) + i}));

	statusBuffer.backDelete(statusBuffer.cx);
	if(query.length === 0) {
		statusBuffer.insert(`${logs.length}/${logs.length}`);
	}
	else {
		statusBuffer.insert(`${matchedLogs.length}/${logs.length}`);
		if(findPropertyResults) {
			statusBuffer.moveRight();
			statusBuffer.insert(`${findPropertyResults.length}`, {color: 'red'});
		}
		if(findValueResults) {
			statusBuffer.moveRight();
			statusBuffer.insert(`${findValueResults.length}`, {color: 'blue'});
		}
	}
	resultsPanelBuffer.fill({char: ' '});
	resultsBuffer.moveTo(0, 0);
	// resultsBuffer.setText('');
	gutterBuffer.moveTo(0, 0);
	// gutterBuffer.setText('');
	// resultsBuffer.buffer[0] = [];
	// resultsBuffer.buffer.length = 1;
	// gutterBuffer.buffer[0] = [];
	// gutterBuffer.buffer.length = 1;

	matchedLogs.forEach(({log, offset}) => {
		printLog(log, offset);
	});

	const resultsLineOffset = logs.length;

	resultsBuffer.y = -resultsBuffer.cy + screenBuffer.height - 2 ;
	gutterBuffer.y = -gutterBuffer.cy + screenBuffer.height - 2 ;

	// resultsBuffer.setText(matchedLogs.join('\n'));
	drawResults();

	// resultsBuffer.draw();
	// statusBuffer.draw();
	// gutterBuffer.draw();
	// screenBuffer.draw();

	// resultsBuffer.drawCursor();
	// screenBuffer.drawCursor();
	// gutterBuffer.drawCursor();
	// screenBuffer.drawCursor();

	// queryTextBuffer.drawCursor();
	// screenBuffer.drawCursor();
}

function drawResults() {
	resultsBuffer.draw({
		dstClipRect: new termkit.Rect({
			xmin: 0,
			xmax: resultsBuffer.width,
			ymin: 0,
			ymax: screenBuffer.height - 3
		})
	});

	gutterBuffer.draw({
		dstClipRect: new termkit.Rect({
			xmin: 0,
			xmax: gutterBuffer.width,
			ymin: 0,
			ymax: screenBuffer.height - 3
		})
	});
	resultsPanelBuffer.draw();
	statusBuffer.draw();
	screenBuffer.draw();
}

function printLog(log, offset) {
	let color = levelColors[log.level];
	// resultsBuffer.insert(offset.toString(), {color, dim: true});
	if((offset+1) % 10 === 0) {
		gutterBuffer.insert((offset+1).toString(), {color: 'blue'});
	}
	else {
	gutterBuffer.insert((offset+1).toString());
	}

	// prefix with dim timestamp
	if(log.timestamp) {
		resultsBuffer.insert(`[${log.timestamp}]`, {color, dim: true});
	}

	if(log.level) {
		resultsBuffer.insert(`[${log.level}] `, {color, dim: true});
	}

	if(log.message) {
		resultsBuffer.insert(`${log.message}`, {color});
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
}
