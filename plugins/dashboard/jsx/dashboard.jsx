/* global io */

var websocketClient = io();

websocketClient.on('/~dashboard/build', (data) => {
	console.log(data);
});

console.log('emitting');
websocketClient.emit('/~dashboard/build', {method: 'POST'});
