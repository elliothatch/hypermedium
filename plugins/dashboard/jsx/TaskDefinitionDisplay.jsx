import React from 'react';

export default class TaskDefinitionDisplay extends React.Component {
	constructor(props) {
		super(props);
		this.handleSelectionChange = this.handleSelectionChange.bind(this);
	}

	handleSelectionChange(data) {
		this.setState({
			selectedTask: data
		});
	}

	render() {
		return <div className="task-definition-display">
			<div className="task-col">
				<ul className="task-definitions">
					{this.props.taskDefinitions && Object.keys(this.props.taskDefinitions).map((tdName,i) =>
						<li key={i}><TaskDefinition taskDefinition={this.props.taskDefinitions[tdName]} onSelectionChange={this.handleSelectionChange}></TaskDefinition></li>
					)}
				</ul>
			</div>
		</div>;
	}
}


class TaskDefinition extends React.Component {
	constructor(props) {
		super(props);
		this.handleClick = this.handleClick.bind(this);
	}

	handleClick(e, data) {
		if(this.props.onSelectionChange) {
			this.props.onSelectionChange(this.props.taskDefinition);
		}
	}

	render() {
		return <div className="task-definitions">
			<div
				className={`card`}
				onClick={this.handleClick}>
				<span className="name">{this.props.taskDefinition.name}</span>
				<span className="description">{this.props.taskDefinition.description}</span>
				<span className="inputs">Inputs: <FileSpec fileSpec={this.props.taskDefinition.inputs} /></span>
				<span className="outputs">Outputs: <FileSpec fileSpec={this.props.taskDefinition.outputs} /></span>
			</div>
		</div>;
	}
}

class FileSpec extends React.Component {
	constructor(props) {
		super(props);
	}

	render() {
		return <span>{this.props.fileSpec.map((fs, i) => <span key={i}>{fs.fType} {fs.count}</span>)}</span>;
	}
}
