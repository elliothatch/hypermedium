import React from 'react';

export default class TaskDisplay extends React.Component {
	constructor(props) {
		super(props);
		this.state = {selectedTask: null};
		this.handleSelectionChange = this.handleSelectionChange.bind(this);
	}

	handleSelectionChange(data) {
		this.setState({
			selectedTask: data
		});
	}

	render() {
		return <div className="task-display">
			<div className="task-col">
				<Task task={this.props.task} onSelectionChange={this.handleSelectionChange} selectedTask={this.state.selectedTask}></Task>
			</div>
			<TaskLogDisplay task={this.state.selectedTask}></TaskLogDisplay>
		</div>;
	}
}


class TaskLogDisplay extends React.Component {
	render() {
		return <div className="log-display">
			{this.props.task && this.props.task.files &&
			(<div>
				<h3>Files</h3>
				<ul className="files">
					{this.props.task.files.map((f,i) => <li key={i}><TaskFileDisplay file={f}></TaskFileDisplay></li>)}
				</ul>
			</div>)}
			{this.props.task && this.props.task.logs &&
			(<div>
				<h3>Logs</h3>
				<ul className="logs">
					{this.props.task.logs.map((l,i) => <li key={i}>{l.message}</li>)}
				</ul>
			</div>)}
			{this.props.task && this.props.task.result &&
			(<div>
				<h3>Result</h3>
				<div>{JSON.stringify(this.props.task.result)}</div>
			</div>)}
		</div>;
	}
}

class TaskFileDisplay extends React.Component {
	render() {
		return <div className="task-file">
			<ul className="inputs">
				{this.props.file.inputs && Object.keys(this.props.file.inputs).map(
					(inProp) => <li key={inProp}>
						{/*<h5>{inProp}</h5>*/}
						<ul>{this.props.file.inputs[inProp].map((inFile, i) => <li key={i}>{inFile}</li>)}</ul>
					</li>
				)}
			</ul>
			<div className="divider"><i className="material-icons">arrow_forward</i></div>
			<ul className="outputs">
				{this.props.file.outputs && Object.keys(this.props.file.outputs).map(
					(outProp) => <li key={outProp}>
						{/*<h5>{outProp}</h5>*/}
						<ul>{this.props.file.outputs[outProp].map((outFile, i) => <li key={i}>{outFile}</li>)}</ul>
					</li>
				)}
			</ul>
		</div>;
	}
}

class Task extends React.Component {
	constructor(props) {
		super(props);
		this.handleClick = this.handleClick.bind(this);
	}

	handleClick(e, data) {
		if(this.props.onSelectionChange) {
			this.props.onSelectionChange(this.props.task);
		}
	}

	render() {
		return <div className="task">
			<div
				className={`card ${this.props.task.status} ${this.props.selectedTask === this.props.task? 'selected': ''}`}
				onClick={this.handleClick}>
				<span className={`${this.props.task.running ? 'loader' : ''}`}></span>
				<span className="status {this.props.task.status}"></span>
				<span className="definition">{this.props.task.definition}</span>
			</div>
			{this.props.task.sType === 'multitask' &&
					<ul className="tasks">
						{this.props.task.steps.map((t,i) => <li key={i}><Task task={t} onSelectionChange={this.props.onSelectionChange} /></li>)}
					</ul>
			}
		</div>;
	}
}

