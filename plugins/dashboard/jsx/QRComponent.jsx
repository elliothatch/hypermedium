import React from 'react';
import qrcodelib from 'qrcode';

export default class QRComponent extends React.Component {
	constructor(props) {
		super(props);
		this.state = {dataUrl: null};
	}

	componentWillMount() {
		this.generateQrCode(this.props.text);
	}

	componentWillReceiveProps(nextProps) {
		if(nextProps.text !== this.props.text) {
			this.generateQrCode(nextProps.text);
		}
	}

	generateQrCode(text) {
		if(text) {
			qrcodelib.toDataURL(text, {}, (err, url) => {
				if(err) {
					console.error('QRComponent', err);
				}
				else {
					this.setState({dataUrl: url});
				}
			});
		}
	}

	render() {
		return <div>
			{this.state.dataUrl && <img src={this.state.dataUrl} />}
		</div>;
	}
}

