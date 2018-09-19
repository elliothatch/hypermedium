#!/usr/bin/env node
const fs = require("fs-extra");
["build", "declarations"].forEach((b) => {
	console.log("rm -R " + b);
	fs.removeSync(b);
});
