import React from 'react';
import ReactDOM from 'react-dom';
/* global io */

// import FileExplorer from 'plugins/filesystem/build/jsx/file-explorer'; // doesn't resolve jsx file
// import FileExplorer from '../../filesystem/build/jsx/file-explorer'; // doesn't find exports
import FileExplorer from 'plugins/filesystem/build/components/file-explorer'; // doesn't resolve jsx file
// NEED TO FIGURE OUT HOW TO SETUP TSCONFIG TO BUILD JSX BUT INCLUDE TYPES FROM OTHER FILES (COMMON/MODULE)

import TaskDefinitionDisplay from "./TaskDefinitionDisplay";
import TaskDisplay from "./TaskDisplay";

var websocketClient = io();

class DashboardComponent extends React.Component {

	handleClickBuild(event) {
		websocketClient.emit('/~dashboard/build', {method: 'POST'});
	}

	render() {
		return <div>
			<header>
				<h1 className="title">Freshr Dashboard</h1>
			</header>
			<div className="page-content">
				<div className="build-display">
					<FileExplorer entry={this.props.fileSystemEntry} />
					{this.props.taskDefinitions && <TaskDefinitionDisplay taskDefinitions={this.props.taskDefinitions} />}
					<button onClick={this.handleClickBuild}>Build</button>
					{this.props.buildTask && <TaskDisplay task={this.props.buildTask} />}
					{this.props.config.categories.map(category => {
						return <div key={category.name} className="config card collapser-wrapper">
							<h2 className="card-title">{category.name} <button className="collapser"></button></h2>
							<div className="card-body collapser-target">
								<ul className="fields">
									{category.fields.map(field => {
										return <li key={field.name}>{field.name}</li>;
									})}
								</ul>
							</div>
						</div>;
					})}
				</div>
			</div>
		</div>;
	}
}

let buildTasks = {};

function getTask(task, taskPath) {
	if(taskPath.length === 0) {
		return task;
	}
	if(task.sType !== 'multitask') {
		throw new Error(`getTask: cannot get child task of buildStep that is not type 'multitask'. Got '${task.sType}'`);
	}
	return getTask(task.steps[taskPath[0]], taskPath.slice(1));
}

var taskDefinitions = {};
// configSocket.on('task-definitions', function(tds) {
	// console.log(tds);
	// taskDefinitions = tds;
	// render();
// });

//configSocket.emit('build');
// configSocket.emit('publicip');
// configSocket.emit('files/src');
// configSocket.emit('task-definitions');

let fileSystemEntry = undefined;

render();

function render() {
	const element = <DashboardComponent config={{categories: []}} taskDefinitions={taskDefinitions} buildTask={buildTasks} fileSystemEntry={fileSystemEntry} />;
	ReactDOM.render(
		element,
		document.getElementById('root')
	);
}

websocketClient.on('/~dashboard/build', (data) => {
	if(data.eType === 'start' && data.buildStep) {
		buildTasks = data.buildStep;
	}

	const task = getTask(buildTasks, data.buildStepPath);
	// console.log(data);
	// console.log(task);
	switch(data.eType) {
		case 'start':
			task.running = true;
			break;
		case 'log':
			if(!task.logs) {
				task.logs = [];
			}
			task.logs.push(data.log);
			break;
		case 'success':
			task.status = data.eType;
			task.result = data.result;
			break;
		case 'error':
			task.status = data.eType;
			task.result = data.error;
			break;
		case 'done':
			task.running = false;
			break;
	}
	render();
	// console.log(data);
});


websocketClient.on('filesystem/watch', (data) => {
	console.log(data);
});

websocketClient.on('filesystem/files', (data) => {
	fileSystemEntry = data;
	console.log(data);
	render();
});

websocketClient.emit('filesystem/watch');
websocketClient.emit('filesystem/files');


