#!/usr/bin/env node
const freshlog = require('freshlog');
const rxjs = require('rxjs');

rxjs.timer(0, 1000).subscribe(x => freshlog.Log.info(x, { [String.fromCharCode(85+(x%7))]: 'abcdef', a: x*x, b: String.fromCharCode(65+(x%10),65+(x%10),65+(x%10))}));

