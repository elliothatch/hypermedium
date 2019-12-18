import * as React from 'react';
import * as ReactDom from 'react-dom';

import { FileSystem } from '../index';

export namespace FileExplorer {
	export interface Props {
		entry?: FileSystem.Entry;
	}

	export interface State {
		selectedEntry?: FileSystem.Entry;
		currentPath: FileSystem.Entry[];
	}
}

export default class FileExplorer extends React.Component<FileExplorer.Props, FileExplorer.State> {
	constructor(props: FileExplorer.Props) {
		super(props);

		this.handleChangeDirectory = this.handleChangeDirectory.bind(this);
		this.handleSelectionChange = this.handleSelectionChange.bind(this);

		this.state = {
			selectedEntry: undefined,
			currentPath: this.pathFromEntry(this.props.entry, this.props.entry)
		};
	}

	componentWillReceiveProps(nextProps: FileExplorer.Props): void {
		if(nextProps.entry !== this.props.entry) {
			this.setState({
				selectedEntry: undefined,
				currentPath: this.pathFromEntry(nextProps.entry, nextProps.entry)
			});
		}
	}

	handleChangeDirectory(entry: FileSystem.Entry): void {
		this.setState({
			currentPath: this.pathFromEntry(this.props.entry, entry)
		});
	}

	/**
	 * Calculate a path array from an entry in the directory tree
	*/
	pathFromEntry(rootEntry?: FileSystem.Entry, entry?: FileSystem.Entry): FileSystem.Entry[] {
		if(!rootEntry || !entry) {
			return [];
		}
		// convert each part of the path into an entry, ignoring the first entry (the root entry)
		return entry.path.split('/').slice(1).reduce((path, entryName) => {
			if(path[path.length - 1].fType !== 'dir') {
				throw new Error('pathFromEntry: Trying to find a file or directory in a non-directory file');
			}
			var entry = (path[path.length-1] as FileSystem.Entry.Directory).contents.find((e) => e.name === entryName);
			if(!entry) {
				throw new Error(`Directory '${[path[path.length-1].path, entryName].join('/')}' not found`);
			}
			path.push(entry);
			return path;
		}, [rootEntry]);
	}

	handleSelectionChange(entry: FileSystem.Entry): void {
		this.setState({
			selectedEntry: entry
		});
	}

	render() {
		return <div className="file-explorer">
			<div>File Explorer</div>
			<FileExplorerPath path={this.state.currentPath} onChangeDirectory={this.handleChangeDirectory}></FileExplorerPath>
			<ul className="entries">
				{this.props.entry
					&& this.state.currentPath.length > 0
					&& this.state.currentPath[this.state.currentPath.length-1].fType === 'dir'
					&& (this.state.currentPath[this.state.currentPath.length-1] as FileSystem.Entry.Directory).contents.map(
					(e) => <FileExplorerEntry key={e.path} entry={e} onSelectionChange={this.handleSelectionChange} onChangeDirectory={this.handleChangeDirectory} selected={this.state.selectedEntry === e}></FileExplorerEntry>)
				}
			</ul>
		</div>;
	}
}

export namespace FileExplorerPath {
	export interface Props {
		onChangeDirectory: (entry: FileSystem.Entry) => void;
		path: FileSystem.Entry[];
	}
}

class FileExplorerPath extends React.Component<FileExplorerPath.Props> {
	constructor(props: FileExplorerPath.Props) {
		super(props);
		this.handleClickUpDirectory = this.handleClickUpDirectory.bind(this);
		this.handleClickDirectory = this.handleClickDirectory.bind(this);
	}

	handleClickUpDirectory(e: React.MouseEvent) {
		if(this.props.path.length > 1) {
			this.props.onChangeDirectory(this.props.path[this.props.path.length-2]);
		}
	}
	handleClickDirectory(entry: FileSystem.Entry) {
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

export namespace FileExplorerPathEntry {
	export interface Props {
		entry: FileSystem.Entry;
		onClickDirectory: (entry: FileSystem.Entry) => void;
	}
}

class FileExplorerPathEntry extends React.Component<FileExplorerPathEntry.Props> {
	constructor(props: FileExplorerPathEntry.Props) {
		super(props);
		this.handleClick= this.handleClick.bind(this);
	}

	handleClick(e: React.MouseEvent) {
		this.props.onClickDirectory(this.props.entry);
	}
	render() {
		return <button onClick={this.handleClick}>{this.props.entry.name}</button>;
	}
}

class FileExplorerEntry extends React.Component<FileExplorerEntry.Props> {
	protected lastClickTime: number;
	protected doubleClickDelay: number;

	constructor(props: FileExplorerEntry.Props) {
		super(props);
		this.handleClick = this.handleClick.bind(this);
		this.lastClickTime = Date.now();
		this.doubleClickDelay = 800;
	}

	handleClick(e: React.MouseEvent) {
		if(this.props.selected && this.props.entry.fType === 'dir' && Date.now() - this.lastClickTime < this.doubleClickDelay) {
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
				{this.props.entry.fType === 'file' && <i className="material-icons">insert_drive_file</i>}
				{this.props.entry.fType === 'dir' && <i className="material-icons">folder</i>}
				{this.props.entry.fType === 'unknown' && '?'}
				{this.props.entry.name}
			</div>
		</li>;
	}
}

export namespace FileExplorerEntry {
	export interface Props {
		entry: FileSystem.Entry;
		selected: boolean;

		onChangeDirectory: (entry: FileSystem.Entry) => void;
		onSelectionChange: (entry: FileSystem.Entry) => void;
	}
}
