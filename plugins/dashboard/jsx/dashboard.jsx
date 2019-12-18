import React from 'react';
import ReactDOM from 'react-dom';
/* global io */

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

render();

function render() {
	const element = <DashboardComponent config={{categories: []}} taskDefinitions={taskDefinitions} buildTask={buildTasks} />;
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
	console.log(data);
	console.log(task);
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
		case 'error':
			// task.running = false;
			task.status = task.eType;
			break;
		case 'done':
			task.running = false;
			break;
	}
	render();
	// console.log(data);
});