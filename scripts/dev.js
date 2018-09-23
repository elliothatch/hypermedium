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

freshrLogs.on('line', function(line) {
    try {
        var log = JSON.parse(line);
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
    }
    catch(err) {
        console.error(line);
    }
});
