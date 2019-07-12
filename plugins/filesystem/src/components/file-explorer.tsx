import React from 'react';

export default class FileExplorer extends React.Component {
	constructor(props) {
		super(props);

		this.handleChangeDirectory = this.handleChangeDirectory.bind(this);
		this.handleSelectionChange = this.handleSelectionChange.bind(this);

		this.state = {
			selectedEntry: null,
			currentPath: this.pathFromEntry(this.props.entry, this.props.entry)
		};
	}

	componentWillReceiveProps(nextProps) {
		if(nextProps.entry !== this.props.entry) {
			this.setState({
				selectedEntry: null,
				currentPath: this.pathFromEntry(nextProps.entry, nextProps.entry)
			});
		}
	}

	handleChangeDirectory(entry) {
		this.setState({
			currentPath: this.pathFromEntry(this.props.entry, entry)
		});
	}

	/**
	 * Calculate a path array from an entry in the directory tree
	*/
	pathFromEntry(rootEntry, entry) {
		if(!rootEntry || !entry) {
			return [];
		}
		// convert each part of the path into an entry, ignoring the first entry (the root entry)
		return entry.path.split('/').slice(1).reduce((path, entryName) => {
			var entry = path[path.length-1].entries.find((e) => e.name === entryName);
			if(!entry) {
				throw new Error(`Directory '${[path[path.length-1].path, entryName].join('/')}' not found`);
			}
			path.push(entry);
			return path;
		}, [rootEntry]);
	}

	handleSelectionChange(entry) {
		this.setState({
			selectedEntry: entry
		});
	}

	render() {
		return <div className="file-explorer">
			<div>File Explorer</div>
			<FileExplorerPath path={this.state.currentPath} onChangeDirectory={this.handleChangeDirectory}></FileExplorerPath>
			<ul className="entries">
				{this.props.entry && this.state.currentPath.length > 0 && this.state.currentPath[this.state.currentPath.length-1].entries.map(
					(e) => <FileExplorerEntry key={e.path} entry={e} onSelectionChange={this.handleSelectionChange} onChangeDirectory={this.handleChangeDirectory} selected={this.state.selectedEntry === e}></FileExplorerEntry>)
				}
			</ul>
		</div>;
	}
}

class FileExplorerPath extends React.Component {
	constructor(props) {
		super(props);
		this.handleClickUpDirectory = this.handleClickUpDirectory.bind(this);
		this.handleClickDirectory = this.handleClickDirectory.bind(this);
	}

	handleClickUpDirectory(e, data) {
		if(this.props.path.length > 1) {
			this.props.onChangeDirectory(this.props.path[this.props.path.length-2]);
		}
	}
	handleClickDirectory(entry) {
		this.props.onChangeDirectory(entry);
	}
	render() {
		return <div className="path">
			<div className="directories">
				<button className="up-directory-button" disabled={this.props.path.length <= 1} onClick={this.handleClickUpDirectory}><i className="material-icons">arrow_back</i></button>
				{this.props.path.map((e) => <FileExplorerPathEntry key={e.path} entry={e} onClickDirectory={this.handleClickDirectory} />)}
			</div>
		</div>;
	}
}

class FileExplorerPathEntry extends React.Component {
	constructor(props) {
		super(props);
		this.handleClick= this.handleClick.bind(this);
	}

	handleClick(e, data) {
		this.props.onClickDirectory(this.props.entry);
	}
	render() {
		return <button onClick={this.handleClick}>{this.props.entry.name}</button>;
	}
}

class FileExplorerEntry extends  React.Component {
	constructor(props) {
		super(props);
		this.handleClick = this.handleClick.bind(this);
		this.lastClickTime = Date.now();
		this.doubleClickDelay = 800;
	}

	handleClick(e, data) {
		if(this.props.selected && this.props.entry.type === 'directory' && Date.now() - this.lastClickTime < this.doubleClickDelay) {
			this.props.onChangeDirectory(this.props.entry);
		}
		else {
			this.props.onSelectionChange(this.props.entry);
		}
		this.lastClickTime = Date.now();
	}

	render() {
		return <li>
			<div className={`card${this.props.selected ? ' selected' : ''}`} onClick={this.handleClick}>
				{this.props.entry.type === 'file' && <i className="material-icons">insert_drive_file</i>}
				{this.props.entry.type === 'directory' && <i className="material-icons">folder</i>}
				{this.props.entry.name}
			</div>
		</li>;
	}
}

